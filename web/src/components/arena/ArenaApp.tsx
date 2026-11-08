"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraFrame } from "@/components/ui/CameraFrame";
import { Stamp, Target } from "@/components/ui/marks";
import { MakePanel } from "./MakePanel";
import { LibraryDrawer, sizeLabel } from "./LibraryDrawer";
import { ResultsSheet } from "./ResultsSheet";
import { createArenaSim, type ArenaSim, type FrameHeader } from "./simAdapter";
import type { ArenaView, Placement } from "@/three/arenaView";
import { getLibrary, getPhysics, loadCourse, objectUrl, postResult, saveCourse, type LibraryEntry, type CourseDoc } from "@/lib/client/api";
import type { ContactEvent, SceneSpec, TrialSummary } from "@/sim/types";

type Mode = "blind" | "planner" | "manual";
type Placed = Placement & { density?: number };
type LogLine = { t: number; text: string; tone: "fault" | "pass" | "ink" };

const DEFAULT_GOAL = { x: 4.5, y: 0 };
const DEFAULT_START = { x: 0, y: 0, yaw: 0 };
// slugs of library objects used for the first course a visitor sees
const STARTER = ["traffic-cone", "cardboard-box", "kitchen-chair", "car-tire", "basketball"];

let uidN = 0;
const newUid = () => `o${Date.now().toString(36)}${(uidN++).toString(36)}`;

export function ArenaApp({ courseId, openMake, addId }: { courseId?: string; openMake?: boolean; addId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ArenaView | null>(null);
  const simRef = useRef<ArenaSim | null>(null);
  const headerRef = useRef<FrameHeader | null>(null);

  const [boot, setBoot] = useState<"loading" | "ready" | "error">("loading");
  const [bootMsg, setBootMsg] = useState("Loading the physics engine");
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [libLoading, setLibLoading] = useState(true);
  const [tab, setTab] = useState<"make" | "library">(openMake ? "make" : "library");
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [start] = useState(DEFAULT_START);
  const [mode, setMode] = useState<Mode>("blind");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<FrameHeader["status"]>("running");
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [trials, setTrials] = useState<TrialSummary | null>(null);
  const [trialProgress, setTrialProgress] = useState<number | null>(null);
  const [pushes, setPushes] = useState(false);
  const [title, setTitle] = useState("Untitled course");
  const [toast, setToast] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [readout, setReadout] = useState({ speed: 0, t: 0, contacts: 0 });
  const sceneVersion = useRef(0);
  const prevStatus = useRef<FrameHeader["status"]>("running");

  const byId = useMemo(() => new Map(library.map((e) => [e.id, e])), [library]);
  const byUid = useMemo(() => new Map(placed.map((p) => [p.uid, p])), [placed]);

  const say = useCallback((text: string, tone: LogLine["tone"] = "ink") => {
    setLog((l) => [{ t: headerRef.current?.t ?? 0, text, tone }, ...l].slice(0, 40));
  }, []);

  // ---- boot: renderer, physics, library, course ----
  useEffect(() => {
    let alive = true;
    let offFrame: (() => void) | undefined;
    let offContact: (() => void) | undefined;
    (async () => {
      try {
        const { ArenaView } = await import("@/three/arenaView");
        if (!alive || !canvasRef.current) return;
        const view = new ArenaView(canvasRef.current);
        viewRef.current = view;
        view.setGoal(DEFAULT_GOAL.x, DEFAULT_GOAL.y);
        view.setStart(DEFAULT_START.x, DEFAULT_START.y, DEFAULT_START.yaw);
        view.onSelect = (uid) => setSelected(uid);
        view.onMove = (uid, x, y) => setPlaced((ps) => ps.map((p) => (p.uid === uid ? { ...p, x, y } : p)));
        view.onGoal = (x, y) => setGoal({ x, y });

        setBootMsg("Loading the robot and its walking controller");
        const sim = await createArenaSim();
        if (!alive) return sim.dispose();
        simRef.current = sim;
        const { robotVisuals } = await sim.init();
        await view.setRobot(robotVisuals);
        offFrame = sim.onFrame((buf, layout, h) => {
          headerRef.current = h;
          view.applyFrame(buf, layout.header, layout.robotGeoms);
        });
        const lastSaid = new Map<string, number>();
        offContact = sim.onContact((c: ContactEvent) => {
          const uid = c.entityId;
          view.flashContact(uid);
          // one line per object per second of sim time, not one per contact
          const prev = lastSaid.get(uid);
          if (prev != null && c.t - prev < 1 && c.t >= prev) return;
          lastSaid.set(uid, c.t);
          say(`Touched ${c.entityName} with the ${c.robotBody.replace(/_link|_/g, " ").replace(/\s+/g, " ").trim()}`, "ink");
        });
        setBoot("ready");
      } catch (e) {
        console.error(e);
        if (alive) {
          setBoot("error");
          setBootMsg((e as Error).message);
        }
      }
    })();
    getLibrary()
      .then((items) => alive && setLibrary(items))
      .catch(() => {})
      .finally(() => alive && setLibLoading(false));
    return () => {
      alive = false;
      offFrame?.();
      offContact?.();
      simRef.current?.dispose();
      viewRef.current?.dispose();
    };
  }, [say]);

  // readout + status polling at 8 Hz (React does not need 60 Hz)
  useEffect(() => {
    const t = setInterval(() => {
      const h = headerRef.current;
      if (!h) return;
      setReadout({ speed: h.speed, t: h.t, contacts: h.contacts });
      if (prevStatus.current !== h.status) {
        if (h.status === "fell") say(`Fell at ${h.t.toFixed(2)} s`, "fault");
        if (h.status === "goal") say(`Reached the goal in ${h.t.toFixed(2)} s`, "pass");
        prevStatus.current = h.status;
        setStatus(h.status);
      }
    }, 125);
    return () => clearInterval(t);
  }, [say]);

  // ---- first course: a saved one, or a starter set from the library ----
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || boot !== "ready") return;
    if (courseId) {
      seeded.current = true;
      loadCourse(courseId)
        .then(({ course }) => {
          setTitle(course.title);
          setGoal(course.goal);
          viewRef.current?.setGoal(course.goal.x, course.goal.y);
          setMode(course.mode);
          setPushes(!!course.pushes);
          setPlaced(course.objects.map((o) => ({ uid: newUid(), objectId: o.objectId, name: o.name, x: o.x, y: o.y, yaw: o.yaw, density: o.density })));
          say(`Loaded "${course.title}"`);
        })
        .catch(() => say("That course could not be loaded. Starting an empty one.", "fault"));
      return;
    }
    if (libLoading) return;
    seeded.current = true;
    const pick = STARTER.map((s) => library.find((e) => e.slug === s)).filter(Boolean) as LibraryEntry[];
    const fallback = library.filter((e) => e.kind === "object").slice(0, 3);
    let chosen = (pick.length >= 2 ? pick : fallback).slice(0, 3);
    const extra = addId ? library.find((e) => e.id === addId) : undefined;
    if (extra) chosen = [extra, ...chosen.filter((e) => e.id !== extra.id)].slice(0, 3);
    setPlaced(chosen.map((e, i) => ({ uid: newUid(), objectId: e.id, name: e.name, x: 1.6 + i * 0.95, y: i === 1 ? -0.35 : 0.3 * (i ? 1 : -0.4), yaw: i * 0.6 })));
  }, [boot, courseId, libLoading, library, say, addId]);

  // ---- keep the view and the physics scene in sync with placements ----
  const physics = useCallback((objectId: string) => getPhysics(objectId), []);

  const rebuild = useCallback(
    async (opts: { keepRunning?: boolean } = {}) => {
      const sim = simRef.current;
      const view = viewRef.current;
      if (!sim || !view) return;
      const v = ++sceneVersion.current;
      const objs = await Promise.all(
        placed.map(async (p) => {
          const ph = await physics(p.objectId);
          const density = p.density ?? 400;
          // mass from the closed mesh volume when known (hull volume overstates hollow shapes)
          return { id: p.uid, name: p.name, parts: ph.parts, x: p.x, y: p.y, yaw: p.yaw, density, mass: ph.volume ? ph.volume * density : undefined };
        }),
      );
      if (v !== sceneVersion.current) return;
      const scene: SceneSpec = { objects: objs, start, goal };
      await sim.setScene(scene);
      view.setOrder(placed.map((p) => p.uid));
      sim.setMode(mode);
      if (mode === "planner") view.setPath(await sim.path());
      else view.setPath(null);
      if (!opts.keepRunning) {
        sim.pause();
        setRunning(false);
      }
    },
    [placed, physics, start, goal, mode],
  );

  useEffect(() => {
    const view = viewRef.current;
    if (!view || boot !== "ready") return;
    const keep = new Set(placed.map((p) => p.uid));
    for (const p of placed) view.upsertObject(p, objectUrl(p.objectId, "visual.glb"));
    // remove stale
    (view as unknown as { objects: Map<string, unknown> }).objects.forEach((_v, uid) => {
      if (!keep.has(uid)) view.removeObject(uid);
    });
    rebuild();
  }, [placed, boot, rebuild]);

  useEffect(() => {
    viewRef.current?.setGoal(goal.x, goal.y);
  }, [goal]);

  // ---- manual steering ----
  useEffect(() => {
    if (mode !== "manual") return;
    const keys = new Set<string>();
    const send = () => {
      const f = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 0.4 : 0);
      const turn = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
      simRef.current?.setCommand({ vx: f * 0.6, vy: 0, yaw: turn * 0.7 });
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      keys.add(e.key.toLowerCase());
      send();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      send();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode]);

  // ---- actions ----
  function addEntry(e: LibraryEntry) {
    const n = placed.length;
    const p: Placed = { uid: newUid(), objectId: e.id, name: e.name, x: Math.min(goal.x - 0.8, 1.4 + (n % 4) * 0.8), y: ((n % 3) - 1) * 0.45, yaw: (n * 0.7) % Math.PI };
    setPlaced((ps) => [...ps, p]);
    setSelected(p.uid);
    viewRef.current?.select(p.uid);
    say(`Placed ${e.name}`);
  }

  const onMade = useCallback(
    (objectId: string, name: string) => {
      getLibrary().then(setLibrary).catch(() => {});
      const p: Placed = { uid: newUid(), objectId, name, x: 2.2, y: 0, yaw: 0 };
      setPlaced((ps) => [...ps, p]);
      say(`Lux3D made ${name}. Dropping it in.`, "pass");
    },
    [say],
  );

  function play() {
    const sim = simRef.current;
    if (!sim) return;
    if (status !== "running") sim.reset();
    sim.setMode(mode);
    sim.play();
    setRunning(true);
    setTrials(null);
    viewRef.current?.clearTrials();
  }
  function pause() {
    simRef.current?.pause();
    setRunning(false);
  }
  function reset() {
    simRef.current?.reset();
    simRef.current?.pause();
    setRunning(false);
    setStatus("running");
    say("Reset");
  }

  async function runTrials() {
    const sim = simRef.current;
    if (!sim || mode === "manual") return;
    pause();
    setTrials(null);
    setTrialProgress(0);
    viewRef.current?.clearTrials();
    const seed = Math.floor(Math.random() * 1e6);
    try {
      const summary = await sim.runTrials({ n: 10, seed, mode, pushes: pushes ? { count: 1, force: 120 } : null, maxSeconds: 20 }, (done) => setTrialProgress(done));
      setTrials(summary);
      viewRef.current?.showTrials(summary.trials);
      say(`10 runs: ${Math.round(summary.passRate * 100)}% reached the goal`, summary.passRate >= 0.5 ? "pass" : "fault");
      if (courseIdSaved.current) postResult(courseIdSaved.current, { passRate: summary.passRate, trials: 10, seed, mode }).catch(() => {});
    } catch (e) {
      say(`Trials stopped: ${(e as Error).message}`, "fault");
    } finally {
      setTrialProgress(null);
    }
  }

  const courseIdSaved = useRef<string | null>(courseId ?? null);
  async function share() {
    const doc: CourseDoc = {
      title: title.trim() || "Untitled course",
      objects: placed.map((p) => ({ objectId: p.objectId, name: p.name, x: +p.x.toFixed(3), y: +p.y.toFixed(3), yaw: +p.yaw.toFixed(3), density: p.density })),
      start,
      goal: { x: +goal.x.toFixed(3), y: +goal.y.toFixed(3) },
      mode: mode === "manual" ? "blind" : mode,
      pushes,
      best: trials ? { passRate: trials.passRate, trials: 10, seed: trials.trials[0]?.seed ?? 0 } : null,
    };
    try {
      const { id } = await saveCourse(doc);
      courseIdSaved.current = id;
      const url = `${location.origin}/c/${id}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      setToast(`Saved. Link copied: ${url.replace(/^https?:\/\//, "")}`);
      if (trials) postResult(id, { passRate: trials.passRate, trials: 10, seed: trials.trials[0]?.seed ?? 0, mode }).catch(() => {});
    } catch (e) {
      setToast(`Could not save: ${(e as Error).message}`);
    }
    setTimeout(() => setToast(null), 4500);
  }

  const sel = selected ? byUid.get(selected) : null;
  const selEntry = sel ? byId.get(sel.objectId) : null;

  function updateSel(patch: Partial<Placed>) {
    if (!sel) return;
    setPlaced((ps) => ps.map((p) => (p.uid === sel.uid ? { ...p, ...patch } : p)));
  }

  const statusStamp =
    status === "fell" ? (
      <Stamp tone="fault" animate rotate={-7} className="bg-white/90 text-[15px]">
        Fell
      </Stamp>
    ) : status === "goal" ? (
      <Stamp tone="pass" animate rotate={-5} className="bg-white/90 text-[15px]">
        Reached goal
      </Stamp>
    ) : null;

  return (
    <div className="flex min-h-[100svh] flex-col bg-concrete md:h-[100svh]">
      {/* top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink/10 px-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2 font-bold [font-stretch:118%]" aria-label="Proving Ground home">
          <Target size={22} />
          <span className="hidden sm:inline">Proving Ground</span>
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          aria-label="Course name"
          className="hidden h-9 w-48 rounded-[8px] bg-transparent px-2 font-semibold outline-none hover:bg-ink/5 focus:bg-paper md:block lg:w-64"
        />
        <div role="radiogroup" aria-label="Robot mode" className="ml-auto flex rounded-[10px] bg-ink/[0.07] p-1 text-[13px] font-semibold">
          {(
            [
              ["blind", "Blind walk"],
              ["planner", "Planner"],
              ["manual", "Steer"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                simRef.current?.setMode(m);
                if (m !== "planner") viewRef.current?.setPath(null);
                else simRef.current?.path().then((p) => viewRef.current?.setPath(p));
              }}
              className={`h-8 rounded-[8px] px-2.5 sm:px-3 ${mode === m ? "bg-paper shadow-sm" : "text-ink-3 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={share} disabled={!placed.length} className="hidden h-9 rounded-[10px] border border-ink/15 px-3 text-[14px] font-semibold hover:bg-ink/5 disabled:opacity-40 sm:block">
          Save and share
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* viewport */}
        <div className="relative order-1 h-[52svh] shrink-0 p-2 md:order-2 md:h-auto md:min-w-0 md:flex-1 md:p-3">
          <CameraFrame
            label={`CAM 01 · ${mode === "blind" ? "BLIND WALK" : mode === "planner" ? "PLANNER" : "STEER"}`}
            clock={() => headerRef.current?.t ?? null}
            pxPerMetre={() => viewRef.current?.pxPerMetre() ?? null}
            className="h-full rounded-[4px]"
            right={
              <div className="space-y-0.5 text-right">
                <div>{`${readout.speed.toFixed(2)} M/S`}</div>
                <div>{`CONTACTS ${readout.contacts}`}</div>
                <div>{`${placed.length} OBJECTS`}</div>
              </div>
            }
            bottomRight={<span className="hidden lg:inline">{mode === "manual" ? "W A S D or arrow keys to steer" : "Drag objects or the flag"}</span>}
          >
            <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="Arena: drag objects and the goal flag; the robot walks when you press Walk" />
            {boot !== "ready" && (
              <div className="absolute inset-0 grid place-items-center bg-cam/85">
                <div className="text-center">
                  {boot === "loading" ? (
                    <>
                      <Target size={34} spin className="mx-auto" />
                      <p className="mt-4 text-[15px] text-white/80">{bootMsg}…</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[15px] text-white">The physics engine could not start in this browser.</p>
                      <p className="mt-1 text-[13px] text-white/60">{bootMsg}. A recent Chrome, Edge, Firefox or Safari with WebAssembly is needed.</p>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="absolute right-5 top-20 sm:right-8">{statusStamp}</div>
            {trialProgress != null && (
              <div className="absolute inset-x-0 bottom-14 mx-auto w-fit rounded-[8px] bg-black/70 px-4 py-2 text-[13px] text-white">
                Running trial {Math.min(10, trialProgress + 1)} of 10 at full speed…
              </div>
            )}
            {/* run controls */}
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 sm:bottom-5">
              {running ? (
                <button onClick={pause} className="h-11 rounded-[10px] bg-white px-5 font-semibold text-ink">
                  Pause
                </button>
              ) : (
                <button onClick={play} disabled={boot !== "ready"} className="h-11 rounded-[10px] bg-target px-5 font-semibold text-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] disabled:opacity-50">
                  {status === "running" ? "Walk" : "Walk again"}
                </button>
              )}
              <button onClick={reset} disabled={boot !== "ready"} className="h-11 rounded-[10px] border border-white/25 bg-black/40 px-4 font-semibold text-white disabled:opacity-50">
                Reset
              </button>
              <button
                onClick={runTrials}
                disabled={boot !== "ready" || mode === "manual" || trialProgress != null || !placed.length}
                title={mode === "manual" ? "Trials need Blind walk or Planner mode" : undefined}
                className="h-11 whitespace-nowrap rounded-[10px] border border-white/25 bg-black/40 px-3 font-semibold text-white disabled:opacity-50 sm:px-4"
              >
                <span className="sm:hidden">10 trials</span>
                <span className="hidden sm:inline">Run 10 trials</span>
              </button>
            </div>
          </CameraFrame>
        </div>

        {/* left rail */}
        <aside className="order-2 flex flex-col border-ink/10 md:order-1 md:min-h-0 md:w-[330px] md:shrink-0 md:border-r">
          <div role="tablist" className="flex shrink-0 gap-1 px-3 pt-3">
            {(
              [
                ["library", "Library"],
                ["make", "Make with Lux3D"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`h-9 flex-1 rounded-[8px] text-[14px] font-semibold ${tab === k ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/5"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="p-3 md:min-h-0 md:flex-1 md:overflow-y-auto">
            {tab === "make" ? (
              <MakePanel onReady={onMade} />
            ) : (
              <div className="h-[60svh] md:h-full">
                <LibraryDrawer items={library} loading={libLoading} onAdd={addEntry} />
              </div>
            )}
          </div>
        </aside>

        {/* right rail */}
        <aside className={`order-3 border-ink/10 md:w-[300px] md:shrink-0 md:border-l ${panelOpen ? "" : "md:w-10"}`}>
          <div className="space-y-4 p-3">
            {sel ? (
              <div className="sheet p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{sel.name}</div>
                    {selEntry && <div className="data mt-0.5 text-[11.5px] text-ink-3">{sizeLabel(selEntry.size)}</div>}
                  </div>
                  <button onClick={() => { setPlaced((ps) => ps.filter((p) => p.uid !== sel.uid)); setSelected(null); }} className="text-[13px] font-semibold text-fault hover:underline">
                    Remove
                  </button>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-[13px]">
                  <dt className="text-ink-3">Parts</dt>
                  <dd className="tnum">{selEntry?.parts ?? "—"}</dd>
                  <dt className="text-ink-3">Made from</dt>
                  <dd>{selEntry?.source === "photo" ? "a photo" : selEntry?.source === "text" ? "a sentence" : "the library"}</dd>
                </dl>
                <label className="mt-3 block text-[13px]">
                  <span className="flex justify-between text-ink-3">
                    <span>Density</span>
                    <span className="tnum text-ink">{sel.density ?? 400} kg/m³</span>
                  </span>
                  <input type="range" min={60} max={2400} step={20} value={sel.density ?? 400} onChange={(e) => updateSel({ density: +e.target.value })} className="mt-1 w-full accent-[#141517]" />
                  <span className="text-[11.5px] text-ink-3">Foam 60 · wood 600 · water 1000 · rock 2400</span>
                </label>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => updateSel({ yaw: sel.yaw - Math.PI / 8 })} className="h-9 flex-1 rounded-[8px] border border-ink/15 text-[13px] font-semibold hover:bg-ink/5">
                    Turn left
                  </button>
                  <button onClick={() => updateSel({ yaw: sel.yaw + Math.PI / 8 })} className="h-9 flex-1 rounded-[8px] border border-ink/15 text-[13px] font-semibold hover:bg-ink/5">
                    Turn right
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-[3px] border border-dashed border-ink/20 p-4 text-[13.5px] text-ink-3">
                Click an object in the arena to see its size, parts and mass. Drag it to move it; drag the yellow flag to move the goal.
              </div>
            )}

            <label className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" checked={pushes} onChange={(e) => setPushes(e.target.checked)} className="h-4 w-4 accent-[#141517]" />
              Shove the robot once per trial (120 N)
            </label>

            <ResultsSheet summary={trials} running={trialProgress} names={Object.fromEntries(placed.map((p) => [p.uid, p.name]))} mode={mode} />

            <div>
              <h3 className="text-[13px] font-semibold text-ink-3">Log</h3>
              <ol className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[12.5px]">
                {log.length === 0 && <li className="text-ink-3">Press Walk. Contacts and falls show up here.</li>}
                {log.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="data w-12 shrink-0 text-ink-3">{l.t.toFixed(2)}s</span>
                    <span className={l.tone === "fault" ? "text-fault" : l.tone === "pass" ? "text-pass" : ""}>{l.text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <button onClick={share} disabled={!placed.length} className="h-10 w-full rounded-[10px] border border-ink/15 text-[14px] font-semibold hover:bg-ink/5 disabled:opacity-40 sm:hidden">
              Save and share
            </button>
          </div>
        </aside>
      </div>
      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-ink px-4 py-3 text-[14px] text-white shadow-lg">
          {toast}
        </div>
      )}
      <span className="sr-only">{panelOpen ? "" : ""}</span>
      <button className="sr-only" onClick={() => setPanelOpen((v) => !v)}>
        Toggle details panel
      </button>
    </div>
  );
}
