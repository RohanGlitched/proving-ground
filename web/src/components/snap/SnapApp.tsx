"use client";
// The phone side of pairing: take a photo, send it to Lux3D, watch it land on the big screen.
import { useEffect, useState } from "react";
import { getJob, makeObject, type PublicJob } from "@/lib/client/api";
import { shrinkPhoto } from "@/lib/client/shrinkPhoto";
import { Target, Stamp } from "@/components/ui/marks";

export function SnapApp({ code }: { code: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [job, setJob] = useState<PublicJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<"checking" | "ok" | "missing">("checking");
  const [linked, setLinked] = useState(true);

  useEffect(() => {
    if (!/^[A-Z2-9]{5}$/.test(code)) return setRoom("missing");
    fetch(`/api/rooms/${code}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((r: { exists?: boolean }) => setRoom(r.exists ? "ok" : "missing"))
      .catch(() => setRoom("ok")); // network hiccup: let them try; the send step checks again
  }, [code]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const t = setInterval(() => getJob(job.id).then(setJob).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [job]);

  async function send() {
    if (!file || room === "missing") return;
    setBusy(true);
    setErr(null);
    try {
      const chk = await fetch(`/api/rooms/${code}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({ exists: true }));
      if (!chk.exists) {
        setRoom("missing");
        return;
      }
      const r = await makeObject({ image: await shrinkPhoto(file), label: label.trim() || undefined });
      const posted = await fetch(`/api/rooms/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: r.jobId }) }).catch(() => null);
      setLinked(!!posted?.ok);
      setJob(r.job ?? (await getJob(r.jobId)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-md flex-col px-4 py-6">
      <div className="flex items-center gap-2 font-bold [font-stretch:118%] [font-variation-settings:'wdth'_118]">
        <Target size={22} /> Proving Ground
        <span className="data ml-auto rounded-[6px] bg-ink px-2 py-1 text-[12px] text-white">ROOM {code}</span>
      </div>
      <h1 className="placard-sm mt-8 text-[31px]">Photograph one object</h1>
      <p className="mt-2 text-[16px] leading-relaxed text-ink-2">Lux3D turns it into a 3D object at its real size. It drops into the arena on the other screen in about two minutes.</p>

      {room === "missing" && (
        <div className="sheet mt-6 p-5">
          <Stamp tone="fault" rotate={-4}>No arena</Stamp>
          <p className="mt-3 text-[15px]">No arena is open with the code {code}. Open the arena on a computer, choose Make with Lux3D, then Phone, and scan the QR code it shows.</p>
        </div>
      )}
      {!job && room !== "missing" && (
        <>
          <label className="mt-6 block cursor-pointer overflow-hidden rounded-[12px] border-2 border-dashed border-ink/25 bg-paper text-center">
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Your photo" className="mx-auto max-h-[46svh] object-contain" />
            ) : (
              <div className="px-6 py-16">
                <div className="text-[18px] font-semibold">Open the camera</div>
                <div className="mt-1 text-[14px] text-ink-3">Fill the frame with the object; a plain background helps.</div>
              </div>
            )}
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder="What is it? (optional)"
            className="mt-4 h-12 w-full rounded-[10px] border border-ink/15 bg-paper px-3 text-[16px] outline-none focus:border-route"
          />
          <button onClick={send} disabled={!file || busy} className="mt-4 h-13 h-12 w-full rounded-[10px] bg-target text-[17px] font-semibold disabled:opacity-45">
            {busy ? "Sending…" : file ? "Send to the arena" : "Take a photo first"}
          </button>
          <p className="mt-3 text-[14px] text-ink-3">Your photo and the object are shown in the public library.</p>
          {err && <p className="mt-3 text-fault">{err}</p>}
        </>
      )}

      {job && (
        <div className="sheet mt-6 p-5" aria-live="polite">
          {job.status === "done" ? (
            <>
              <Stamp tone="pass" animate rotate={-5} className="text-[16px]">
                Delivered
              </Stamp>
              <p className="mt-4 text-[16px]">
                {linked ? "Look at the big screen: it is in the arena now." : "It is in the shared library, but the arena did not answer. Find it under Library on the big screen."}
              </p>
              <button onClick={() => { setJob(null); setFile(null); setLabel(""); }} className="mt-5 h-11 w-full rounded-[10px] border border-ink/20 font-semibold">
                Snap another
              </button>
            </>
          ) : job.status === "failed" ? (
            <>
              <Stamp tone="fault" rotate={-5}>Failed</Stamp>
              <p className="mt-3">{job.error ?? "Lux3D could not use this photo. Try again with the object filling the frame."}</p>
              <button onClick={() => setJob(null)} className="mt-5 h-11 w-full rounded-[10px] border border-ink/20 font-semibold">
                Try another photo
              </button>
            </>
          ) : (
            <>
              <div className="font-semibold">Lux3D is building it</div>
              <p className="mt-1 text-[14px] text-ink-2">
                {job.queuePosition && job.queuePosition > 1 ? `Number ${job.queuePosition} in the queue · ` : ""}about {Math.max(1, Math.round(job.etaSeconds / 60))} min left
              </p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full animate-pulse rounded-full bg-target" style={{ width: `${Math.round((job.stages.filter((s) => s.status === "done" || s.status === "skipped").length / job.stages.length) * 100)}%` }} />
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
