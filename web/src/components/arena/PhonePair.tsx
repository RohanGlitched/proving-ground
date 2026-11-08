"use client";
// Desktop side of pairing: show a QR code; anything the phone sends lands in this arena.
import { useEffect, useRef, useState } from "react";
import { getJob, type PublicJob } from "@/lib/client/api";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function roomCode() {
  try {
    const saved = sessionStorage.getItem("pg-room");
    if (saved && /^[A-Z2-9]{5}$/.test(saved)) return saved;
  } catch {}
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  const c = Array.from(a, (n) => ALPHA[n % ALPHA.length]).join("");
  try {
    sessionStorage.setItem("pg-room", c);
  } catch {}
  return c;
}

export function PhonePair({ onReady }: { onReady: (objectId: string, name: string) => void }) {
  const [code] = useState(roomCode);
  const [qr, setQr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, PublicJob>>({});
  const delivered = useRef(new Set<string>());
  const url = typeof window !== "undefined" ? `${location.origin}/snap/${code}` : "";

  useEffect(() => {
    import("qrcode").then((Q) => Q.toDataURL(url, { margin: 1, width: 320, color: { dark: "#141517", light: "#f7f6f2" } }).then(setQr));
  }, [url]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/rooms/${code}`, { cache: "no-store" }).then((x) => x.json());
        const ids: string[] = (r.jobs ?? []).map((j: { id: string }) => j.id);
        for (const id of ids) {
          if (delivered.current.has(id)) continue;
          const j = await getJob(id);
          if (!alive) return;
          setJobs((m) => ({ ...m, [id]: j }));
          if (j.status === "done" && j.result) {
            delivered.current.add(id);
            onReady(j.result.objectId, j.input.label ?? "a photographed object");
          }
          if (j.status === "failed") delivered.current.add(id);
        }
      } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [code, onReady]);

  const list = Object.values(jobs).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="space-y-4">
      <div className="sheet flex items-center gap-4 p-4">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`QR code for ${url}`} className="h-32 w-32 shrink-0 rounded-[4px]" />
        ) : (
          <div className="h-32 w-32 shrink-0 animate-pulse rounded-[4px] bg-ink/10" />
        )}
        <div>
          <div className="text-[13px] text-ink-3">Scan with your phone, or open</div>
          <div className="data mt-1 break-all text-[12.5px]">{url.replace(/^https?:\/\//, "")}</div>
          <div className="data mt-2 text-[22px] tracking-[0.2em]">{code}</div>
        </div>
      </div>
      <p className="text-[13.5px] leading-relaxed text-ink-2">
        Photograph something real on your phone. Lux3D builds it, and it drops into this arena on its own, at its real size.
      </p>
      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((j) => (
            <li key={j.id} className="flex items-center gap-2 text-[13.5px]">
              <span className={`h-2.5 w-2.5 rounded-full ${j.status === "done" ? "bg-pass" : j.status === "failed" ? "bg-fault" : "animate-pulse bg-target"}`} />
              <span className="truncate">{j.input.label ?? "Photo from your phone"}</span>
              <span className="ml-auto text-[12px] text-ink-3">{j.status === "done" ? "in the arena" : j.status === "failed" ? "failed" : `~${Math.max(1, Math.round(j.etaSeconds / 60))} min`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
