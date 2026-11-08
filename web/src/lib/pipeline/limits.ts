import { createHash } from "node:crypto";
import { store as defaultStore, updateJSON, type Store } from "../storage";
import { config } from "./config";

/**
 * Public rate limits, kept in storage so every instance sees the same counts:
 * LIMIT_PER_IP_HOUR jobs per IP per rolling hour (default 3) and LIMIT_PER_DAY jobs per UTC day overall
 * (default 40). IPs are stored only as salted hashes.
 */

export const dayKey = (now = Date.now(), bucket = "jobs") => `limits/${new Date(now).toISOString().slice(0, 10)}-${bucket}.json`;
type DayDoc = { total: number; ips: Record<string, number[]> };

export function hashIp(ip: string): string {
  const salt = process.env.IP_SALT ?? process.env.AHOLO_API_KEY?.slice(-8) ?? "proving-ground";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
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
      if (d.total >= config.perDay) {
        const tomorrow = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
        result = { ok: false, reason: "Today's free generations are used up. The library is still open, and new slots open at 00:00 UTC.", retryAfter: Math.ceil((tomorrow - now) / 1000) };
        return d;
      }
      if (mine.length >= config.perIpHour) {
        result = { ok: false, reason: `You can make ${config.perIpHour} objects an hour. Try again in a little while.`, retryAfter: Math.ceil((mine[0] + 3600_000 - now) / 1000) };
        return d;
      }
      mine.push(now);
      d.ips[ipHash] = mine;
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
  let ok = false;
  await updateJSON<DayDoc>(
    s,
    dayKey(now, bucket),
    () => ({ total: 0, ips: {} }),
    (d) => {
      const mine = (d.ips[ipHash] ?? []).filter((t) => t > now - 3600_000);
      ok = mine.length < max;
      if (ok) {
        mine.push(now);
        d.total += 1;
      }
      d.ips[ipHash] = mine;
      return d;
    },
    20,
  );
  return ok;
}

export async function dailyRemaining(s: Store = defaultStore(), now = Date.now()): Promise<number> {
  const d = (await s.getJSON<DayDoc>(dayKey(now)))?.value;
  return Math.max(0, config.perDay - (d?.total ?? 0));
}
