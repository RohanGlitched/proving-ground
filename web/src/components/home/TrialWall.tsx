"use client";
// Ten seeded runs of a real course, computed in a worker when this section scrolls into view and
// drawn as a top-down test-track plot: object footprints, every path, every fall.
import { useEffect, useRef, useState } from "react";
import { Stamp } from "@/components/ui/marks";
import { getLibrary, getPhysics, type LibraryEntry } from "@/lib/client/api";
import { hull2d } from "@/sim/hull";
import type { SceneSpec, TrialResult } from "@/sim/types";
import { defaultDensity } from "@/lib/density";

const GOAL = { x: 4.2, y: 0 };
const SLOTS = [
  { x: 1.4, y: 0.12, yaw: 0.5 },
  { x: 2.5, y: -0.28, yaw: 1.1 },
  { x: 3.1, y: 0.4, yaw: 0.2 },
];
const PUSH = 170;

type Foot = { name: string; poly: number[] };

export function TrialWall() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [runs, setRuns] = useState<(TrialResult | null)[]>(Array(10).fill(null));
  const [state, setState] = useState<"idle" | "loading" | "running" | "done" | "error">("idle");
  const [seed, setSeed] = useState(7);
  const [course, setCourse] = useState<{ scene: SceneSpec; feet: Foot[]; names: Record<string, string> } | null>(null);
  const anim = useRef<{ r: TrialResult; born: number }[]>([]);
  const started = useRef(false);

  // build the course from the library once the section is near
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      async (ents) => {
        if (!ents.some((e) => e.isIntersecting) || started.current) return;
        started.current = true;
        io.disconnect();
        setState("loading");
        try {
          const items = (await getLibrary()).filter((e) => e.kind === "object");
          const pref = ["kitchen-chair", "traffic-cone", "sneaker"];
          const chosen: LibraryEntry[] = [];
          for (const s of pref) {
            const e = items.find((i) => i.slug === s);
            if (e) chosen.push(e);
          }
          for (const e of items) if (chosen.length < 3 && !chosen.includes(e)) chosen.push(e);
          const phys = await Promise.all(chosen.map((e) => getPhysics(e.id)));
          const objects = chosen.map((e, i) => ({ id: `t${i}`, name: e.name, parts: phys[i].parts, ...SLOTS[i], mass: phys[i].volume ? phys[i].volume! * defaultDensity(e) : undefined }));
          const feet: Foot[] = objects.map((o) => {
            const xy: number[] = [];
            const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
            for (const p of o.parts) for (let k = 0; k < p.points.length; k += 3) {
              const px = p.points[k], py = p.points[k + 1];
              xy.push(o.x + c * px - s * py, o.y + s * px + c * py);
            }
            return { name: o.name, poly: hull2d(xy) };
          });
          setCourse({ scene: { objects, goal: GOAL, start: { x: 0, y: 0, yaw: 0 } }, feet, names: Object.fromEntries(objects.map((o) => [o.id, o.name])) });
        } catch {
          setState("error");
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // run the trials
  useEffect(() => {
    if (!course) return;
    let alive = true;
    let dispose: (() => void) | undefined;
    (async () => {
      setState("running");
      setRuns(Array(10).fill(null));
      anim.current = [];
      const { createSim } = await import("@/sim/client");
      const sim = createSim();
      dispose = () => sim.dispose();
      try {
        await sim.runTrials({ scene: course.scene, n: 10, seed, mode: "blind", pushes: { count: 1, force: PUSH }, maxSeconds: 16 }, (_d, _n, r) => {
          if (!alive) return;
          anim.current.push({ r, born: performance.now() });
          setRuns((prev) => {
            const next = prev.slice();
            next[r.index] = r;
            return next;
          });
        });
        if (alive) setState("done");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
      dispose?.();
    };
  }, [course, seed]);

  // draw
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) {
        c.width = W * dpr;
        c.height = H * dpr;
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // world window x -0.6..4.8, y -1.3..1.3
      const x0 = -0.6, x1 = 4.8, y0 = -1.3, y1 = 1.3;
      const s = Math.min(W / (x1 - x0), H / (y1 - y0));
      const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
      const X = (x: number) => ox + (x - x0) * s;
      const Y = (y: number) => oy + (y1 - y) * s;
      g.fillStyle = "#0f1012";
      g.fillRect(0, 0, W, H);
      // grid, 0.5 m
      g.lineWidth = 1;
      for (let x = Math.ceil(x0 * 2) / 2; x <= x1; x += 0.5) {
        g.strokeStyle = Number.isInteger(x) ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)";
        g.beginPath();
        g.moveTo(X(x), Y(y0));
        g.lineTo(X(x), Y(y1));
        g.stroke();
      }
      for (let y = Math.ceil(y0 * 2) / 2; y <= y1; y += 0.5) {
        g.strokeStyle = Number.isInteger(y) ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)";
        g.beginPath();
        g.moveTo(X(x0), Y(y));
        g.lineTo(X(x1), Y(y));
        g.stroke();
      }
      g.strokeStyle = "rgba(245,196,0,0.6)";
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(X(0), Y(0));
      g.lineTo(X(GOAL.x), Y(0));
      g.stroke();
      g.setLineDash([]);
      // start and goal
      g.strokeStyle = "rgba(255,255,255,0.5)";
      g.beginPath();
      g.arc(X(0), Y(0), 0.3 * s, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "#f5c400";
      g.beginPath();
      g.arc(X(GOAL.x), Y(GOAL.y), 0.4 * s, 0, Math.PI * 2);
      g.globalAlpha = 0.18;
      g.fill();
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(X(GOAL.x), Y(GOAL.y), 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#141517";
      g.beginPath();
      g.moveTo(X(GOAL.x), Y(GOAL.y));
      g.arc(X(GOAL.x), Y(GOAL.y), 7, -Math.PI / 2, 0);
      g.fill();
      g.beginPath();
      g.moveTo(X(GOAL.x), Y(GOAL.y));
      g.arc(X(GOAL.x), Y(GOAL.y), 7, Math.PI / 2, Math.PI);
      g.fill();
      // object footprints
      g.font = "500 11px var(--font-mono-data), monospace";
      for (const f of course?.feet ?? []) {
        g.beginPath();
        for (let i = 0; i < f.poly.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(f.poly[i]), Y(f.poly[i + 1]));
        g.closePath();
        g.fillStyle = "rgba(210,209,203,0.22)";
        g.fill();
        g.strokeStyle = "rgba(210,209,203,0.8)";
        g.stroke();
        let mx = 0, my = -1e9;
        for (let i = 0; i < f.poly.length; i += 2) {
          mx += f.poly[i] / (f.poly.length / 2);
          my = Math.max(my, f.poly[i + 1]);
        }
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.fillText(f.name.toUpperCase(), X(mx) - g.measureText(f.name.toUpperCase()).width / 2, Y(my) - 6);
      }
      // paths, drawn as they arrive
      const now = performance.now();
      for (const { r, born } of anim.current) {
        const k = Math.min(1, (now - born) / 1400);
        const n = Math.max(2, Math.floor((r.path.length / 2) * k));
        g.strokeStyle = r.result === "goal" ? "rgba(30,158,90,0.95)" : r.result === "fell" ? "rgba(224,54,44,0.95)" : "rgba(160,160,160,0.8)";
        g.lineWidth = 2;
        g.beginPath();
        for (let i = 0; i < n; i++) (i ? g.lineTo : g.moveTo).call(g, X(r.path[2 * i]), Y(r.path[2 * i + 1]));
        g.stroke();
        if (k >= 1 && r.fallPoint) {
          const fx = X(r.fallPoint[0]), fy = Y(r.fallPoint[1]);
          g.strokeStyle = "#e0362c";
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(fx - 6, fy - 6);
          g.lineTo(fx + 6, fy + 6);
          g.moveTo(fx - 6, fy + 6);
          g.lineTo(fx + 6, fy - 6);
          g.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [course]);

  const done = runs.filter(Boolean) as TrialResult[];
  const passes = done.filter((r) => r.result === "goal").length;
  return (
    <div ref={wrap}>
      <div className="relative overflow-hidden rounded-[4px] bg-cam">
        <canvas ref={canvas} className="block aspect-[2.1/1] w-full" aria-label="Top-down plot of ten trial runs: object footprints, robot paths and falls" />
        <div className="data pointer-events-none absolute left-4 top-3 text-[11px] text-white/70">CAM 03 · TOP · 10 RUNS · SEED {seed}</div>
        <div className="data pointer-events-none absolute right-4 top-3 text-[11px] text-white/70">
          {state === "running" ? `RUNNING ${done.length}/10` : state === "done" ? `${passes}/10 REACHED THE FLAG` : state === "loading" ? "BUILDING COURSE" : ""}
        </div>
        {state === "error" && <div className="absolute inset-0 grid place-items-center text-[14px] text-white/80">The trial runner could not start in this browser.</div>}
      </div>
      <ol className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
        {runs.map((r, i) => (
          <li key={i} className="sheet flex flex-col items-center gap-1 px-1 py-2 text-center">
            <span className="data text-[10px] text-ink-3">RUN {String(i + 1).padStart(2, "0")}</span>
            {r ? (
              <Stamp tone={r.result === "goal" ? "pass" : r.result === "fell" ? "fault" : "ink"} animate rotate={i % 2 ? -5 : 4} className="!px-1 !text-[10.5px]">
                {r.result === "goal" ? "pass" : r.result === "fell" ? "fell" : "stuck"}
              </Stamp>
            ) : (
              <span className="mt-1 h-2 w-2 animate-pulse rounded-full bg-ink/20" />
            )}
            <span className="data text-[10px] text-ink-3">{r ? `${r.time.toFixed(1)}s` : ""}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-[14px] text-ink-2">
        <span>
          Blind walk, three Lux3D objects, one {PUSH} N shove per run at a random moment.
          {state === "done" && (
            <>
              {" "}
              <strong className="text-ink">
                {passes} of 10 reached the flag.
              </strong>
            </>
          )}
        </span>
        <button
          onClick={() => setSeed((s) => s + 11)}
          disabled={state === "running" || !course}
          className="ml-auto h-9 rounded-[8px] border border-ink/20 px-3 font-semibold hover:bg-ink/5 disabled:opacity-40"
        >
          Run ten more
        </button>
      </div>
    </div>
  );
}
