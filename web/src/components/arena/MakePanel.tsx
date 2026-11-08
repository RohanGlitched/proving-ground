"use client";
// Make an object with Lux3D: a sentence or a photo in, a physics-ready object out.
import { useEffect, useRef, useState } from "react";
import { getJob, getStatus, makeObject, type PublicJob } from "@/lib/client/api";
import { PhonePair } from "./PhonePair";

const EXAMPLES = ["a stack of three old car tires", "a garden gnome", "a wooden step stool", "a laundry basket full of towels", "a traffic cone", "a beanbag chair"];
const STYLES = [
  { id: "photorealistic", label: "Real" },
  { id: "cartoon", label: "Cartoon" },
  { id: "hand_painted", label: "Painted" },
  { id: "fantasy", label: "Fantasy" },
];

const STAGE_COPY: Record<string, string> = {
  "upload-input": "Uploading to Aholo",
  generate: "Lux3D is building it",
  "fetch-result": "Collecting the model",
  "upload-for-split": "Preparing part-split",
  "part-split": "Lux3D part-split",
  "upload-for-rig": "Preparing the rig",
  rig: "Lux3D rigging",
  "upload-for-retarget": "Preparing the walk",
  retarget: "Lux3D animation",
  "upload-for-articulation": "Preparing motion",
  articulate: "Lux3D articulation",
  process: "Hulls and mass",
  publish: "Adding to the library",
};

export function MakePanel({ onReady, initialMode = "text" }: { onReady: (objectId: string, name: string) => void; initialMode?: "text" | "photo" | "phone" }) {
  const [mode, setMode] = useState<"text" | "photo" | "phone">(initialMode);
  const [text, setText] = useState("");
  const [style, setStyle] = useState("photorealistic");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const done = useRef<string | null>(null);
  const [queue, setQueue] = useState<{ queueLength: number; dailyRemaining?: number } | null>(null);
  useEffect(() => {
    getStatus().then(setQueue).catch(() => {});
  }, [job]);

  // poll the job; each poll also advances it on the server
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const j = await getJob(job.id);
        if (alive) setJob(j);
      } catch {
        /* keep polling; a failed poll is not a failed job */
      }
    }, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [job]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (job?.status === "done" && job.result && done.current !== job.id) {
      done.current = job.id;
      onReady(job.result.objectId, job.input.label ?? job.input.text ?? "your object");
    }
  }, [job, onReady]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const canMake = !busy && (mode === "text" ? text.trim().length >= 3 : !!file) && !(job && (job.status === "queued" || job.status === "running"));
  const reason =
    job && (job.status === "queued" || job.status === "running")
      ? "One object at a time: this one is still being made."
      : mode === "text" && text.trim().length < 3
        ? "Describe an object in a few words."
        : mode === "photo" && !file
          ? "Choose or take a photo of one object."
          : null;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const r = await makeObject(mode === "text" ? { text: text.trim(), style } : { image: file!, label: file?.name.replace(/\.[a-z]+$/i, "") });
      setJob(r.job ?? (await getJob(r.jobId)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const elapsed = job ? Math.max(0, Math.round(((job.finishedAt ?? now) - job.createdAt) / 1000)) : 0;
  const visible = job?.stages.filter((s) => s.status !== "skipped" && !s.name.startsWith("upload-for") && s.name !== "fetch-result") ?? [];

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Input" className="grid grid-cols-3 rounded-[10px] bg-ink/[0.06] p-1 text-[13.5px] font-semibold">
        {(["text", "photo", "phone"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`h-9 rounded-[8px] transition-colors ${mode === m ? "bg-paper shadow-sm" : "text-ink-3 hover:text-ink"}`}
          >
            {m === "text" ? "Describe" : m === "photo" ? "Photo" : "Phone"}
          </button>
        ))}
      </div>

      {mode === "phone" ? (
        <PhonePair onReady={onReady} />
      ) : mode === "text" ? (
        <div className="space-y-3">
          <label className="block">
            <span className="text-[13px] font-semibold text-ink-2">What should Lux3D make?</span>
            <input
              value={text}
              maxLength={120}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canMake && submit()}
              placeholder="a stack of three old car tires"
              className="mt-1.5 h-11 w-full rounded-[10px] border border-ink/15 bg-paper px-3 text-[15px] outline-none placeholder:text-ink-3/70 focus:border-route"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((x) => (
              <button key={x} onClick={() => setText(x)} className="rounded-full border border-ink/12 px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-ink/30 hover:text-ink">
                {x}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-ink-3">Look</span>
            {STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStyle(s.id)}
                aria-pressed={style === s.id}
                className={`rounded-[6px] px-2 py-1 ${style === s.id ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/5"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <label className="relative block cursor-pointer overflow-hidden rounded-[10px] border-2 border-dashed border-ink/20 bg-paper text-center hover:border-ink/40">
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Your photo" className="mx-auto max-h-44 object-contain" />
          ) : (
            <div className="px-4 py-8">
              <div className="font-semibold">Take or choose a photo</div>
              <div className="mt-1 text-[13px] text-ink-3">One object, plain background works best. JPEG, PNG or WebP up to 8 MB.</div>
            </div>
          )}
        </label>
      )}

      {mode !== "phone" && (
      <>
      <div>
        <button
          disabled={!canMake}
          onClick={submit}
          className="h-11 w-full rounded-[10px] bg-target font-semibold shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? "Sending to Lux3D…" : "Make it"}
        </button>
        {reason && !busy && <p className="mt-2 text-[12.5px] text-ink-3">{reason}</p>}
        {!job && queue && (
          <p className="mt-2 text-[12.5px] text-ink-3">
            Free · about 4 min with part-split, and you can keep playing while it builds ·{" "}
            {queue.queueLength ? `${queue.queueLength} ahead of you in the Lux3D queue` : "the Lux3D queue is empty"}
            {queue.dailyRemaining != null ? ` · ${queue.dailyRemaining} makes left today` : ""}
          </p>
        )}
        {error && <p className="mt-2 text-[13px] text-fault">{error}</p>}
      </div>

      {job && (
        <div className="sheet p-4" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <div className="truncate font-semibold">{job.input.label ?? job.input.text ?? "Your photo"}</div>
            <div className="data shrink-0 text-[12px] text-ink-3">{elapsed}s</div>
          </div>
          {job.status === "queued" && (
            <p className="mt-1 text-[13px] text-ink-2">
              {job.queuePosition && job.queuePosition > 1 ? `Number ${job.queuePosition} in the queue. ` : "Starting now. "}
              About {Math.max(1, Math.round(job.etaSeconds / 60))} min.
            </p>
          )}
          <ol className="mt-3 space-y-1.5">
            {visible.map((s) => (
              <li key={s.name} className="flex items-center gap-2.5 text-[13.5px]">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    s.status === "done" ? "bg-pass" : s.status === "running" ? "animate-pulse bg-target" : s.status === "failed" ? "bg-fault" : "bg-ink/15"
                  }`}
                />
                <span className={s.status === "pending" ? "text-ink-3" : ""}>{STAGE_COPY[s.name] ?? s.name}</span>
                {s.startedAt && s.endedAt && <span className="data ml-auto text-[11.5px] text-ink-3">{Math.round((s.endedAt - s.startedAt) / 1000)}s</span>}
                {s.status === "running" && s.startedAt && (
                  <span className="data ml-auto text-[11.5px] text-ink-3">{Math.round((now - s.startedAt) / 1000)}s</span>
                )}
              </li>
            ))}
          </ol>
          {job.status === "done" && <p className="mt-3 text-[13px] font-semibold text-pass">Ready. It is dropping into the arena.</p>}
          {job.status === "failed" && (
            <p className="mt-3 text-[13px] text-fault">{job.error ?? "Lux3D could not make this one. Try a simpler description or a clearer photo."}</p>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
