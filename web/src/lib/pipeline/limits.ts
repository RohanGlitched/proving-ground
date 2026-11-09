import { createHash } from "node:crypto";
import { store as defaultStore, updateJSON, type Store } from "../storage";
import { config, LIBRARY_SIZE } from "./config";

/**
 * Public rate limits, kept in storage so every instance sees the same counts:
 * LIMIT_PER_IP_HOUR jobs per IP per rolling hour (default 3), LIMIT_PER_IP_DAY jobs per IP per UTC day
 * (default 6) and LIMIT_PER_DAY jobs per UTC day overall (default 40). IPs are stored only as salted
 * hashes, and an IPv6 address counts as its /64 prefix (one home or phone usually holds a whole /64).
 */

export const dayKey = (now = Date.now(), bucket = "jobs") => `limits/${new Date(now).toISOString().slice(0, 10)}-${bucket}.json`;
type DayDoc = { total: number; ips: Record<string, number[]>; day?: Record<string, number> };

/** The part of an address that identifies one client: the address for IPv4, the /64 prefix for IPv6. */
export function ipKey(ip: string): string {
  let a = ip.trim().toLowerCase();
  if (a.startsWith("[")) a = a.slice(1, a.indexOf("]") > 0 ? a.indexOf("]") : undefined);
  a = a.split("%")[0]; // zone id
  if (!a.includes(":")) return a;
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  if (t.length && t[t.length - 1].includes(".")) t.splice(t.length - 1, 1, "0", "0"); // embedded IPv4 sits in the host half
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a; // not an address we understand: key on it whole
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_SALT ?? process.env.AHOLO_API_KEY?.slice(-8) ?? "proving-ground";
  return createHash("sha256").update(`${salt}:${ipKey(ip)}`).digest("hex").slice(0, 16);
}

export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

export type LimitResult = { ok: true; dailyRemaining: number } | { ok: false; reason: string; retryAfter: number };

/** Counts one job for this IP if both limits allow it. */
export async function takeJobSlot(ipHash: string, s: Store = defaultStore(), now = Date.now()): Promise<LimitResult> {
  let result: LimitResult = { ok: false, reason: "", retryAfter: 0 };
  await updateJSON<DayDoc>(
    s,
    dayKey(now),
    () => ({ total: 0, ips: {} }),
    (d) => {
      const hourAgo = now - 3600_000;
      const mine = (d.ips[ipHash] ?? []).filter((t) => t > hourAgo);
      d.day ??= {};
      const today = d.day[ipHash] ?? 0;
      const tomorrow = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
      if (d.total >= config.perDay) {
        result = { ok: false, reason: `Today's free generations are used up. The library of ${LIBRARY_SIZE} objects is still open, and new slots open at 00:00 UTC.`, retryAfter: Math.ceil((tomorrow - now) / 1000) };
        return d;
      }
      if (today >= config.perIpDay) {
        result = { ok: false, reason: `You can make ${config.perIpDay} objects a day, and you have made them all. The library of ${LIBRARY_SIZE} objects is still open, and you can make more after 00:00 UTC.`, retryAfter: Math.ceil((tomorrow - now) / 1000) };
        return d;
      }
      if (mine.length >= config.perIpHour) {
        result = { ok: false, reason: `You can make ${config.perIpHour} objects an hour. Try again in a little while; the library of ${LIBRARY_SIZE} objects is open meanwhile.`, retryAfter: Math.ceil((mine[0] + 3600_000 - now) / 1000) };
        return d;
      }
      mine.push(now);
      d.ips[ipHash] = mine;
      d.day[ipHash] = today + 1;
      d.total += 1;
      result = { ok: true, dailyRemaining: Math.max(0, config.perDay - d.total) };
      return d;
    },
    20,
  );
  return result;
}

/** A generic per-IP limiter for cheap writes (courses, results): `max` per rolling hour per bucket. */
export async function takeSlot(bucket: string, ipHash: string, max: number, s: Store = defaultStore(), now = Date.now()): Promise<boolean> {
  return (await takeCappedSlot(bucket, ipHash, max, Infinity, s, now)) === "ok";
}

/**
 * Like takeSlot, plus an overall cap per UTC day for the bucket. Says which limit refused it:
 * "hour" (this IP's rolling hour is full) or "day" (the bucket's day is full).
 */
export async function takeCappedSlot(bucket: string, ipHash: string, perHour: number, perDay: number, s: Store = defaultStore(), now = Date.now()): Promise<"ok" | "hour" | "day"> {
  let out: "ok" | "hour" | "day" = "hour";
  await updateJSON<DayDoc>(
    s,
    dayKey(now, bucket),
    () => ({ total: 0, ips: {} }),
    (d) => {
      const mine = (d.ips[ipHash] ?? []).filter((t) => t > now - 3600_000);
      out = d.total >= perDay ? "day" : mine.length >= perHour ? "hour" : "ok";
      if (out === "ok") {
        mine.push(now);
        d.total += 1;
      }
      d.ips[ipHash] = mine;
      return d;
    },
    20,
  );
  return out;
}

export async function dailyRemaining(s: Store = defaultStore(), now = Date.now()): Promise<number> {
  const d = (await s.getJSON<DayDoc>(dayKey(now)))?.value;
  return Math.max(0, config.perDay - (d?.total ?? 0));
}
