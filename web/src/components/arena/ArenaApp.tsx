"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraFrame } from "@/components/ui/CameraFrame";
import { Stamp, Target } from "@/components/ui/marks";
import { chime, thud, unlockAudio, whoosh } from "@/lib/client/sfx";
import { defaultDensity } from "@/lib/density";
import { challengeById, recordBest, bestOf, scoreLabel, type Challenge } from "@/lib/challenges";
import { MakePanel } from "./MakePanel";
import { LibraryDrawer, sizeLabel } from "./LibraryDrawer";
import { ResultsSheet } from "./ResultsSheet";
import { createArenaSim, type ArenaSim, type FrameHeader } from "./simAdapter";
import type { ArenaView, Placement } from "@/three/arenaView";
import { getLibrary, getPhysics, loadCourse, objectUrl, postResult, saveCourse, type LibraryEntry, type CourseDoc } from "@/lib/client/api";
import type { ContactEvent, SceneSpec, TrialSummary } from "@/sim/types";

type Mode = "blind" | "planner" | "manual";
type Placed = Placement & { density?: number; kind?: "object" | "mover" };

// a walker crosses the course at x, from one side to the other and back, about 0.9 m/s
const WALK_SPAN = 2.4;
const FACE = Math.PI; // Lux3D people face glTF +Z, which is -Y after the Y-up -> Z-up turn
function crossingPath(x: number, phase = 0) {
  const leg = (2 * WALK_SPAN) / 0.9;
  const keys = [
    { x, y: -WALK_SPAN, yaw: FACE, t: 0 },
    { x, y: WALK_SPAN, yaw: FACE, t: leg },
    { x, y: WALK_SPAN, yaw: 0, t: leg + 0.6 },
    { x, y: -WALK_SPAN, yaw: 0, t: 2 * leg + 0.6 },
    { x, y: -WALK_SPAN, yaw: FACE, t: 2 * leg + 1.2 },
  ];
  if (!phase) return keys;
  // start part-way along the loop
  const T = keys[keys.length - 1].t;
  const shift = (phase % 1) * T;
  return keys.map((k) => ({ ...k, t: (k.t + shift) % T })).sort((a, b) => a.t - b.t);
}
type LogLine = { t: number; text: string; tone: "fault" | "pass" | "ink" };

const DEFAULT_GOAL = { x: 4.5, y: 0 };
const SHOVE_N = 170;
const DRAFT_KEY = "pg-arena-draft-v1";
const DEFAULT_START = { x: 0, y: 0, yaw: 0 };
// slugs of library objects used for the first course a visitor sees
const STARTER = ["cardboard-box", "kitchen-chair", "traffic-cone", "car-tire", "basketball"];

/** The most open spot between start and goal, close to the walking line: new objects never land on the flag or each other. */
function freeSpot(placed: { x: number; y: number; r?: number }[], goal: { x: number; y: number }, start: { x: number; y: number }, r = 0.3) {
  let best = { x: Math.max(1.5, 0.8 + r), y: 0 }, bestScore = -Infinity;
  const x1 = Math.max(1.2, goal.x - 0.6 - r);
  // near the walking line first; widen to the sides only when nothing there is free
  for (const span of [0.75, 2.25]) {
  if (span > 0.75 && bestScore >= 0) break;
  for (let x = 0.8 + r; x <= x1; x += 0.25) {
    for (let y = -span; y <= span; y += 0.25) {
      let d = Math.min(Math.hypot(x - goal.x, y - goal.y) - 0.5 - r, Math.hypot(x - start.x, y - start.y) - 0.8 - r);
      for (const p of placed) d = Math.min(d, Math.hypot(x - p.x, y - p.y) - r - (p.r ?? 0.3));
      const score = Math.min(d, 1.2) - Math.abs(y) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  }
  return best;
}

/** footprint radius of a library object (metres) */
const radiusOf = (e?: { size: [number, number, number] }) => (e ? Math.hypot(e.size[0], e.size[2]) / 2 : 0.3);

let uidN = 0;
const newUid = () => `o${Date.now().toString(36)}${(uidN++).toString(36)}`;

export function ArenaApp({ courseId, openMake, addId, challengeId }: { courseId?: string; openMake?: boolean; addId?: string; challengeId?: string }) {
  const challenge: Challenge | null = challengeById(challengeId);
  // a challenge is played in one mode only: blind for fix and trip, steering for steer
  const challengeMode: Mode | null = challenge ? (challenge.kind === "steer" ? "manual" : "blind") : null;
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
  const modeRef = useRef<Mode>("blind");
  modeRef.current = mode;
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  runningRef.current = running;
  const [stuck, setStuck] = useState(false);
  const progress = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastTouched = useRef<string | null>(null); // name of the last thing the robot touched (for Share this fail)
  const [status, setStatus] = useState<FrameHeader["status"]>("running");
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [trials, setTrials] = useState<TrialSummary | null>(null);
  const [trialProgress, setTrialProgress] = useState<number | null>(null);
  const [pushes, setPushes] = useState(false);
  const [hulls, setHulls] = useState(false);
  const [title, setTitle] = useState("Untitled course");
  const [toast, setToast] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [readout, setReadout] = useState({ speed: 0, t: 0, contacts: 0 });
  const sceneVersion = useRef(0);
  const prevStatus = useRef<FrameHeader["status"]>("running");
  const prevYield = useRef(false);

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
        view.onShove = (angle) => {
          if (!runningRef.current) return;
          simRef.current?.push(SHOVE_N, angle);
        };

        setBootMsg("Loading the robot and its walking controller");
        const sim = await createArenaSim();
        if (!alive) return sim.dispose();
        simRef.current = sim;
        const { robotVisuals } = await sim.init();
        await view.setRobot(robotVisuals);
        offFrame = sim.onFrame((buf, layout, h) => {
          headerRef.current = h;
          view.setFocus(h.pelvis);
          view.applyFrame(buf, layout.header, layout.robotGeoms);
        });
        sim.onPush((e) => {
          const h = headerRef.current;
          if (h) view.showPush(h.pelvis, e.angle, e.force);
          whoosh();
          say(`Shoved with ${e.force.toFixed(0)} N`, "ink");
        });
        const lastSaid = new Map<string, number>();
        offContact = sim.onContact((c: ContactEvent) => {
          const uid = c.entityId;
          view.flashContact(uid);
          lastTouched.current = c.entityName;
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
      if (!!h.yielding !== prevYield.current) {
        prevYield.current = !!h.yielding;
        if (h.yielding) say("Waiting for someone to cross the path", "ink");
      }
      // stuck: running, but less than 15 cm of progress in 5 s of sim time (leaning on a bench, say)
      if (h.status === "running" && runningRef.current && modeRef.current !== "manual") {
        const pr = progress.current;
        // waiting for a walker to cross is not being stuck
        if (!pr || h.yielding || h.t < pr.t || Math.hypot(h.pelvis[0] - pr.x, h.pelvis[1] - pr.y) > 0.15) progress.current = { t: h.t, x: h.pelvis[0], y: h.pelvis[1] };
        else if (h.t - pr.t > 5) {
          progress.current = null;
          simRef.current?.pause();
          setRunning(false);
          setStuck(true);
          say(`Stuck at ${h.t.toFixed(1)} s: no progress for 5 s`, "fault");
        }
      }
      if (prevStatus.current !== h.status) {
        if (h.status === "fell") {
          say(`Fell at ${h.t.toFixed(2)} s`, "fault");
          // the fall in slow motion, with a camera punch and a thud
          viewRef.current?.impact();
          thud();
          simRef.current?.setRate(0.3);
          setTimeout(() => simRef.current?.setRate(1), 1500);
        }
        if (h.status === "goal") {
          say(`Reached the goal in ${h.t.toFixed(2)} s`, "pass");
          chime();
          onGoal.current?.(h.t);
        }
        prevStatus.current = h.status;
        setStatus(h.status);
      }
    }, 125);
    return () => clearInterval(t);
  }, [say]);

  // ---- first course: a saved one, or a starter set from the library ----
  const seeded = useRef(false);
  const [courseFailed, setCourseFailed] = useState(false);
  useEffect(() => {
    if (seeded.current || boot !== "ready") return;
    if (courseId && !courseFailed) {
      seeded.current = true;
      loadCourse(courseId)
        .then(({ course, stats }) => {
          setShared({ title: course.title, stats });
          setTitle(course.title);
          setGoal(course.goal);
          viewRef.current?.setGoal(course.goal.x, course.goal.y);
          setMode(course.mode);
          setPushes(!!course.pushes);
          const loaded = course.objects.map((o) => ({ uid: newUid(), objectId: o.objectId, name: o.name, x: o.x, y: o.y, yaw: o.yaw, density: o.density, kind: o.kind }));
          setPlaced(loaded);
          baseline.current = loaded;
          baselineGoal.current = course.goal;
          if (challenge) {
            setMode(challengeMode!);
            setPushes(false);
            say(`Challenge: ${challenge.title}. ${challenge.brief}`);
          } else say(`Loaded "${course.title}"`);
        })
        .catch(() => {
          say("That course link does not exist (or was removed). Here is the starter course instead.", "fault");
          seeded.current = false;
          courseIdSaved.current = null;
          sigPending.current = false;
          setCourseFailed(true);
        });
      return;
    }
    if (libLoading) return;
    seeded.current = true;
    if (challenge?.kind === "trip") {
      setMode("blind");
      setPlaced([]);
      baseline.current = [];
      say(`Challenge: ${challenge.title}. Add up to ${challenge.maxObjects} objects from the library, then run 10 trials.`);
      return;
    }
    // your own last course in this browser comes back after a reload (not when a link asks for something specific)
    if (!addId) {
      try {
        const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as { placed: Placed[]; goal: { x: number; y: number } } | null;
        const ok = saved?.placed?.length && saved.placed.every((p) => byId.has(p.objectId));
        if (ok) {
          setPlaced(saved!.placed.map((p) => ({ ...p, uid: newUid() })));
          setGoal(saved!.goal);
          viewRef.current?.setGoal(saved!.goal.x, saved!.goal.y);
          say("Restored your last course from this browser. Remove everything to start fresh.");
          return;
        }
      } catch {}
    }
    // the first course is fixed (the one the report and the film describe): a cardboard box and a kitchen chair in
    // the foot path, plus a walking person
    Promise.resolve().then(() => {
      const pick = STARTER.map((s) => library.find((e) => e.slug === s)).filter(Boolean) as LibraryEntry[];
      let chosen = pick.slice(0, 2);
      const added = addId ? library.find((e) => e.id === addId) : undefined;
      const extra = added && added.kind !== "pedestrian" ? added : undefined;
      if (extra) chosen = [extra, ...chosen.filter((e) => e.id !== extra.id)].slice(0, 2);
      const r0 = radiusOf(chosen[0]), r1 = radiusOf(chosen[1]);
      const x0 = Math.max(1.35, 0.8 + r0);
      const spots = [
        { x: x0, y: 0.02, yaw: 0.35 },
        { x: Math.min(DEFAULT_GOAL.x - 0.7 - r1, Math.max(2.75, x0 + r0 + r1 + 0.6)), y: -0.08, yaw: 1.2 },
      ];
      const next: Placed[] = chosen.map((e, i) => ({ uid: newUid(), objectId: e.id, name: e.name, ...spots[i] }));
      const walker = added?.kind === "pedestrian" ? added : library.find((e) => e.kind === "pedestrian");
      if (walker && !extra) next.push({ uid: newUid(), objectId: walker.id, name: walker.name, kind: "mover", x: 2.1, y: 0, yaw: 0 });
      setPlaced(next);
    });
  }, [boot, courseId, courseFailed, libLoading, library, say, addId]);

  // keep a draft of your own course (not shared courses or challenges) so a reload does not lose it
  useEffect(() => {
    if (courseId || challenge || !seeded.current) return;
    try {
      if (placed.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ placed: placed.map(({ uid: _u, ...p }) => p), goal }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [placed, goal, courseId, challenge]);

  // ---- keep the view and the physics scene in sync with placements ----
  const physics = useCallback((objectId: string) => getPhysics(objectId), []);

  const rebuild = useCallback(
    async (opts: { keepRunning?: boolean } = {}) => {
      const sim = simRef.current;
      const view = viewRef.current;
      if (!sim || !view) return;
      const v = ++sceneVersion.current;
      const things = placed.filter((p) => p.kind !== "mover");
      const walkers = placed.filter((p) => p.kind === "mover");
      const objs = await Promise.all(
        things.map(async (p) => {
          const ph = await physics(p.objectId);
          const density = p.density ?? defaultDensity(byId.get(p.objectId));
          // mass from the closed mesh volume when known (hull volume overstates hollow shapes)
          return { id: p.uid, name: p.name, parts: ph.parts, x: p.x, y: p.y, yaw: p.yaw, density, mass: ph.volume ? ph.volume * density : undefined, ...(ph.joints ? { joints: ph.joints } : {}) };
        }),
      );
      const movers = await Promise.all(
        walkers.map(async (p, i) => ({ id: p.uid, name: p.name, parts: (await physics(p.objectId)).parts, path: crossingPath(p.x, i * 0.37), loop: true })),
      );
      if (v !== sceneVersion.current) return;
      const scene: SceneSpec = { objects: objs, movers, start, goal };
      const layout = await sim.setScene(scene);
      view.setOrder(things.map((p) => p.uid), walkers.map((p) => p.uid));
      view.setHinges(layout.hinges ?? []);
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
    for (const p of placed) {
      if (p.kind === "mover") view.upsertMover(p.uid, objectUrl(p.objectId, "visual.glb"));
      else view.upsertObject(p, objectUrl(p.objectId, "visual.glb"));
    }
    // remove stale
    (view as unknown as { objects: Map<string, unknown> }).objects.forEach((_v, uid) => {
      if (!keep.has(uid)) view.removeObject(uid);
    });
    for (const uid of view.moverIds()) if (!keep.has(uid)) view.removeMover(uid);
    rebuild();
  }, [placed, boot, rebuild]);

  useEffect(() => {
    viewRef.current?.setGoal(goal.x, goal.y);
  }, [goal]);

  // results belong to the course they were run on: any edit clears them, and an edited shared course
  // is a new course (its results must not be posted to the original)
  const savedSig = useRef<string | null>(null);
  const sigPending = useRef(!!courseId);
  useEffect(() => {
    setTrials(null);
    viewRef.current?.clearTrials();
    const sig = JSON.stringify([placed.map((p) => [p.objectId, +p.x.toFixed(3), +p.y.toFixed(3), +p.yaw.toFixed(3), p.density ?? null, p.kind ?? null]), goal, mode, pushes]);
    if (sigPending.current && placed.length) {
      sigPending.current = false;
      savedSig.current = sig;
    } else if (savedSig.current !== null && sig !== savedSig.current) {
      courseIdSaved.current = null;
      savedSig.current = null;
    }
  }, [placed, goal, mode, pushes]);

  // steer mode: the camera rides along with the robot
  const wasManual = useRef(false);
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.chase = mode === "manual";
    if (wasManual.current && mode !== "manual") viewRef.current.recenter();
    wasManual.current = mode === "manual";
  }, [mode, boot]);

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
      const k = e.key.toLowerCase();
      keys.add(k);
      if (!runningRef.current && ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) actions.current.play();
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
    if (e.kind === "pedestrian") {
      const walkers = placed.filter((p) => p.kind === "mover").length;
      const p: Placed = { uid: newUid(), objectId: e.id, name: e.name, kind: "mover", x: 1.2 + ((walkers * 1.1) % 2.6), y: 0, yaw: 0 };
      setPlaced((ps) => [...ps, p]);
      say(`${e.name} starts walking across the course`);
      return;
    }
    const spot = freeSpot(placed.map((p) => ({ ...p, r: radiusOf(byId.get(p.objectId)) })), goal, start, radiusOf(e));
    // hinged things face the robot so they open away from it (it can push them open)
    const p: Placed = { uid: newUid(), objectId: e.id, name: e.name, x: spot.x, y: spot.y, yaw: e.kind === "articulated" ? -Math.PI / 2 : (n * 0.7) % Math.PI };
    setPlaced((ps) => [...ps, p]);
    setSelected(p.uid);
    viewRef.current?.select(p.uid);
    say(`Placed ${e.name}`);
  }

  const onMade = useCallback(
    (objectId: string, name: string) => {
      getLibrary().then(setLibrary).catch(() => {});
      setPlaced((ps) => {
        const spot = freeSpot(ps, goal, start);
        return [...ps, { uid: newUid(), objectId, name, x: spot.x, y: spot.y, yaw: 0 }];
      });
      say(`Lux3D made ${name}. Dropping it in.`, "pass");
    },
    [say, goal, start],
  );

  function play() {
    const sim = simRef.current;
    if (!sim) return;
    unlockAudio();
    if (status !== "running" || stuck) sim.reset();
    setStuck(false);
    progress.current = null;
    sim.setRate(1);
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
    viewRef.current?.recenter();
    simRef.current?.reset();
    simRef.current?.pause();
    setRunning(false);
    setStuck(false);
    progress.current = null;
    setStatus("running");
    prevStatus.current = "running";
    setLog([]);
  }

  // ---- challenges: a goal, a limit and a score (see lib/challenges.ts) ----
  const baseline = useRef<Placed[] | null>(null);
  const baselineGoal = useRef<{ x: number; y: number } | null>(null);
  const onGoal = useRef<((t: number) => void) | null>(null);
  const [cleared, setCleared] = useState<{ score: number; best: boolean } | null>(null);
  const [verdictMsg, setVerdictMsg] = useState<string | null>(null);
  const moves = useMemo(() => {
    const b = baseline.current;
    if (!b) return 0;
    const now = new Map(placed.map((p) => [p.uid, p]));
    const changed = b.filter((o) => {
      const p = now.get(o.uid);
      return !p || Math.hypot(p.x - o.x, p.y - o.y) > 0.05 || Math.abs(p.yaw - o.yaw) > 0.1;
    }).length;
    const ids = new Set(b.map((o) => o.uid));
    // the flag counts too: a challenge is won where its course puts the goal
    const g = baselineGoal.current;
    const flag = g && Math.hypot(goal.x - g.x, goal.y - g.y) > 0.05 ? 1 : 0;
    return changed + placed.filter((p) => !ids.has(p.uid)).length + flag;
  }, [placed, goal]);
  useEffect(() => {
    setCleared(null);
    setVerdictMsg(null);
  }, [placed]);
  const [selMass, setSelMass] = useState<number | null>(null);
  const [courseMass, setCourseMass] = useState<number | null>(null);
  const massOf = useCallback(
    async (p: Placed) => {
      const ph = await physics(p.objectId);
      const density = (challenge ? undefined : p.density) ?? defaultDensity(byId.get(p.objectId));
      return Math.min(80, Math.max(0.05, (ph.volume ?? 0) * density));
    },
    [physics, byId, challenge],
  );
  useEffect(() => {
    let live = true;
    const sel = placed.find((p) => p.uid === selected);
    if (sel) massOf(sel).then((m) => live && setSelMass(m)).catch(() => {});
    else setSelMass(null);
    if (challenge?.kind === "trip") Promise.all(placed.map(massOf)).then((ms) => live && setCourseMass(ms.reduce((a, b) => a + b, 0))).catch(() => {});
    return () => {
      live = false;
    };
  }, [placed, selected, massOf, challenge]);
  async function totalMass() {
    let kg = 0;
    for (const p of placed) {
      const ph = await physics(p.objectId);
      const density = (challenge ? undefined : p.density) ?? defaultDensity(byId.get(p.objectId));
      kg += Math.min(80, Math.max(0.05, (ph.volume ?? 0) * density));
    }
    return kg;
  }
  const [stampUp, setStampUp] = useState(false);
  function clear(score: number) {
    if (!challenge) return;
    const best = recordBest(challenge.id, score);
    setCleared({ score, best });
    setStampUp(true);
    setTimeout(() => setStampUp(false), 2800);
    setVerdictMsg(null);
    chime();
    say(`Challenge cleared: ${scoreLabel(challenge, score)}${best ? " (your best)" : ""}`, "pass");
  }
  async function judge(summary: TrialSummary) {
    if (!challenge || challenge.kind === "steer") return;
    if (mode !== "blind" || pushes) return setVerdictMsg("Challenges count blind walks without shoves only.");
    const passes = summary.trials.filter((t) => t.result === "goal").length;
    const falls = summary.trials.filter((t) => t.result === "fell").length;
    if (challenge.kind === "fix") {
      if (moves > (challenge.maxMoves ?? 0)) return setVerdictMsg(`You changed ${moves} objects; the limit is ${challenge.maxMoves}. Press Reset course to start over.`);
      if (passes < (challenge.target ?? 10)) return setVerdictMsg(`${passes} of 10 got through; ${challenge.target} needed. Try moving something else.`);
      return clear(moves);
    }
    const n = placed.length;
    if (n > (challenge.maxObjects ?? 3)) return setVerdictMsg(`${n} objects placed; the limit is ${challenge.maxObjects}.`);
    if (falls < (challenge.target ?? 7)) return setVerdictMsg(`It fell in ${falls} of 10 runs; ${challenge.target} needed.`);
    return clear(Math.round((await totalMass()) * 100) / 100);
  }
  onGoal.current =
    challenge?.kind === "steer" && mode === "manual"
      ? (t: number) => (moves === 0 ? clear(Math.round(t * 10) / 10) : setVerdictMsg("The course was changed, so this run does not count. Press Reset course and steer it as it is."))
      : null;
  function resetCourse() {
    if (baseline.current) setPlaced(baseline.current.map((p) => ({ ...p })));
    const g = baselineGoal.current;
    if (g) {
      setGoal(g);
      viewRef.current?.setGoal(g.x, g.y);
    }
    setTrials(null);
    reset();
  }

  async function runTrials() {
    const sim = simRef.current;
    if (!sim || mode === "manual") return;
    pause();
    setTrials(null);
    setTrialProgress(0);
    viewRef.current?.clearTrials();
    // a challenge uses its own fixed seed: the same layout always gives the same ten runs
    const seed = challenge ? [...challenge.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1_000_003, 7) : Math.floor(Math.random() * 1e6);
    try {
      // draw each run's trail the moment it finishes
      const sofar: NonNullable<typeof trials>["trials"] = [];
      const summary = await sim.runTrials({ n: 10, seed, mode, pushes: pushes ? { count: 1, force: SHOVE_N } : null, maxSeconds: placed.some((p) => p.kind === "mover") ? 30 : 20 }, (done, last) => {
        setTrialProgress(done);
        if (last) {
          sofar.push(last);
          viewRef.current?.showTrials(sofar);
          if (last.result === "fell") thud(0.45);
        }
      });
      setTrials(summary);
      viewRef.current?.showTrials(summary.trials);
      judge(summary);
      say(`10 runs: ${Math.round(summary.passRate * 100)}% reached the goal`, summary.passRate >= 0.5 ? "pass" : "fault");
      if (courseIdSaved.current) postResult(courseIdSaved.current, { passRate: summary.passRate, trials: 10, seed, mode }).catch(() => {});
    } catch (e) {
      say(`Trials stopped: ${(e as Error).message}`, "fault");
    } finally {
      setTrialProgress(null);
    }
  }

  const [replaying, setReplaying] = useState<number | null>(null);
  async function replay(i: number) {
    const sim = simRef.current;
    if (!sim || !trials) return;
    setReplaying(i);
    setLog([]);
    prevStatus.current = "running";
    setStatus("running");
    setRunning(true);
    say(`Replaying run ${String(i + 1).padStart(2, "0")} exactly (same seed)`, "ink");
    try {
      await sim.replay(i);
    } finally {
      setReplaying(null);
      setRunning(false);
    }
  }

  const courseIdSaved = useRef<string | null>(courseId ?? null);
  const [naming, setNaming] = useState(false);
  const [shared, setShared] = useState<{ title: string; stats: { runs: number; trials: number; passes: number; bestPassRate: number | null } | null } | null>(null);
  const steer = useRef({ f: 0, t: 0 });
  const sendSteer = () => simRef.current?.setCommand({ vx: steer.current.f * 0.6, vy: 0, yaw: steer.current.t * 0.7 });
  async function share(force = false, titleOverride?: string): Promise<string | null> {
    if (!force && (!title.trim() || title.trim() === "Untitled course")) {
      setNaming(true);
      return null;
    }
    setNaming(false);
    const doc: CourseDoc = {
      title: (titleOverride ?? title).trim() || "Untitled course",
      objects: placed.map((p) => ({ objectId: p.objectId, name: p.name, x: +p.x.toFixed(3), y: +p.y.toFixed(3), yaw: +p.yaw.toFixed(3), density: p.density, kind: p.kind })),
      start,
      goal: { x: +goal.x.toFixed(3), y: +goal.y.toFixed(3) },
      mode: mode === "manual" ? "blind" : mode,
      pushes,
      best: trials ? { passRate: trials.passRate, trials: 10, seed: trials.trials[0]?.seed ?? 0 } : null,
    };
    try {
      const { id } = await saveCourse(doc);
      courseIdSaved.current = id;
      savedSig.current = JSON.stringify([placed.map((p) => [p.objectId, +p.x.toFixed(3), +p.y.toFixed(3), +p.yaw.toFixed(3), p.density ?? null, p.kind ?? null]), goal, mode, pushes]);
      const url = `${location.origin}/c/${id}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      setToast(`Saved. Link copied: ${url.replace(/^https?:\/\//, "")}`);
      if (trials) postResult(id, { passRate: trials.passRate, trials: 10, seed: trials.trials[0]?.seed ?? 0, mode }).catch(() => {});
      setTimeout(() => setToast(null), 4500);
      return url;
    } catch (e) {
      setToast(`Could not save: ${(e as Error).message}`);
    }
    setTimeout(() => setToast(null), 4500);
    return null;
  }

  /** One tap after a fall: save the course (named after what tripped it) and open a post with the link. */
  async function shareFail() {
    const w = window.open("about:blank", "_blank"); // opened now, inside the click, so pop-up blockers allow it
    // name it after what it fell on: the most common fall cause over ten trials, else the last thing it touched
    const counts = new Map<string, number>();
    for (const r of trials?.trials ?? []) if (r.fallCause) counts.set(r.fallCause, (counts.get(r.fallCause) ?? 0) + 1);
    const topCause = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const culprit = (topCause ? byUid.get(topCause)?.name : null) ?? lastTouched.current;
    const untitled = !title.trim() || title.trim() === "Untitled course";
    let t = untitled ? (culprit ? `Tripped by ${culprit}` : "Robot down") : title;
    if (t.length > 60) t = `${t.slice(0, 57).trimEnd()}...`;
    if (untitled) setTitle(t);
    // an unchanged saved or shared course keeps its link instead of saving a copy
    const reuse = courseIdSaved.current; // its trial results were already posted when the trials finished
    const url = reuse ? `${location.origin}/c/${reuse}` : await share(true, t);
    if (!url) {
      w?.close();
      return;
    }
    const how = trials ? `It got through ${Math.round(trials.passRate * 100)}% of 10 runs.` : `It fell after ${(headerRef.current?.t ?? 0).toFixed(1)} s.`;
    const text = `I built a course from Lux3D objects that trips Unitree's G1 walking policy. ${how} Can you get it through? #Manycorehackathon`;
    const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    if (w) w.location.href = intent;
    else location.href = intent;
  }

  // ?rec=1: expose the arena to the demo-video recorder (camera moves, scripted actions)
  const actions = useRef({ play, pause, reset, runTrials, share, addEntry, setPlaced, setGoal, setMode, setPushes, setTab });
  actions.current = { play, pause, reset, runTrials, share, addEntry, setPlaced, setGoal, setMode, setPushes, setTab };
  useEffect(() => {
    if (boot !== "ready" || !new URLSearchParams(location.search).has("rec")) return;
    (window as unknown as { __pg: unknown }).__pg = {
      view: viewRef.current,
      sim: simRef.current,
      library: () => library,
      placed: () => placed,
      // read the latest actions at call time (each render makes new closures)
      act: new Proxy({}, { get: (_t, k: string) => (actions.current as Record<string, unknown>)[k] }),
      header: () => headerRef.current,
    };
  }, [boot, library, placed]);

  const sel = selected ? byUid.get(selected) : null;
  const selEntry = sel ? byId.get(sel.objectId) : null;

  function updateSel(patch: Partial<Placed>) {
    if (!sel) return;
    setPlaced((ps) => ps.map((p) => (p.uid === sel.uid ? { ...p, ...patch } : p)));
  }

  const statusStamp =
    status === "fell" ? (
      <Stamp tone="fault" animate rotate={-7} onDark className="text-[17px] !px-3 !py-1">
        Fell
      </Stamp>
    ) : stuck ? (
      <Stamp tone="fault" animate rotate={-6} onDark className="text-[17px] !px-3 !py-1">
        Stuck
      </Stamp>
    ) : status === "goal" ? (
      <Stamp tone="pass" animate rotate={-5} onDark className="text-[17px] !px-3 !py-1">
        Reached goal
      </Stamp>
    ) : null;

  return (
    <div className="flex min-h-[100svh] flex-col bg-concrete md:h-[100svh]">
      {/* top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink/10 px-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2 font-bold [font-stretch:118%] [font-variation-settings:'wdth'_118]" aria-label="Proving Ground home">
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
          )
            .filter(([m]) => !challenge || m === challengeMode)
            .map(([m, label]) => (
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
        <button onClick={() => share()} disabled={!placed.length} className="h-9 shrink-0 rounded-[10px] border border-ink/15 px-2.5 text-[14px] font-semibold hover:bg-ink/5 disabled:opacity-40 sm:px-3">
          <span className="sm:hidden">Share</span>
          <span className="hidden sm:inline">Save and share</span>
        </button>
        <h1 className="sr-only">{courseId ? `Shared course: ${title}` : "Proving Ground arena"}</h1>
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
            <div className="absolute right-5 top-20 flex flex-col items-end gap-3 sm:right-8">
              {statusStamp}
              {(status === "fell" || (trials && trials.passRate < 0.5)) && trialProgress == null && placed.length > 0 && (
                <button onClick={shareFail} className="rounded-[8px] bg-white/90 px-3 py-1.5 text-[13px] font-semibold text-ink shadow hover:bg-white">
                  Share this fail
                </button>
              )}
            </div>
            {challenge && (
              <div className="absolute left-4 top-14 max-w-[min(440px,82%)] rounded-[8px] bg-black/70 px-3 py-2 text-[13px] text-white backdrop-blur-sm sm:left-6">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">Challenge: {challenge.title}</span>
                  <a href="/gauntlet#challenges" className="shrink-0 text-[12px] text-white/70 underline-offset-2 hover:underline">
                    All challenges
                  </a>
                </div>
                <div className="mt-0.5 text-white/75">{challenge.brief}</div>
                <div className="data mt-1.5 flex flex-wrap gap-x-4 text-[11.5px] text-target">
                  {challenge.kind === "fix" && (
                    <span>
                      Moved {moves} of {challenge.maxMoves}
                    </span>
                  )}
                  {challenge.kind === "trip" && (
                    <span>
                      Objects {placed.length} of {challenge.maxObjects}
                      {courseMass != null && placed.length > 0 ? ` · ${courseMass < 1 ? `${Math.round(courseMass * 1000)} g` : `${courseMass.toFixed(1)} kg`}` : ""}
                    </span>
                  )}
                  {challenge.kind === "steer" && <span>Steer with WASD, the arrows or the pad</span>}
                  {bestOf(challenge.id) != null && <span>Your best {scoreLabel(challenge, bestOf(challenge.id)!)}</span>}
                  {challenge.par && <span>Par {challenge.par}</span>}
                </div>
                {verdictMsg && <div className="mt-1.5 text-[12.5px] text-[#ffb4ad]">{verdictMsg}</div>}
                {cleared && (
                  <div className="mt-1.5 text-[12.5px] font-semibold text-[#8be0b0]">
                    Cleared: {scoreLabel(challenge, cleared.score)}
                    {cleared.best ? " (your best)" : ""}
                  </div>
                )}
                {challenge.kind !== "trip" && moves > 0 && (
                  <button onClick={resetCourse} className="mt-1.5 text-[12px] font-semibold text-white underline underline-offset-2">
                    Reset course
                  </button>
                )}
              </div>
            )}
            {cleared && challenge && stampUp && (
              <div className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center">
                <Stamp tone="pass" animate rotate={-6} onDark className="!px-4 !py-2 text-[22px] sm:text-[28px]">
                  Cleared · {scoreLabel(challenge, cleared.score)}
                  {cleared.best ? " · best" : ""}
                </Stamp>
              </div>
            )}
            {/* the course banner steps aside once there is a result stamp, so it never covers Share this fail */}
            {!challenge && shared && !statusStamp && !trials && (
              <div className="absolute left-4 top-14 max-w-[min(420px,80%)] rounded-[8px] bg-black/60 px-3 py-2 text-[13px] text-white backdrop-blur-sm sm:left-6">
                <div className="font-semibold">Shared course: {shared.title}</div>
                <div className="text-white/70">
                  {shared.stats && shared.stats.trials > 0
                    ? `Robot pass rate ${Math.round((shared.stats.passes / shared.stats.trials) * 100)}% over ${shared.stats.trials} recorded trials. `
                    : ""}
                  Edit anything; saving makes your own copy.
                </div>
              </div>
            )}
            {mode === "manual" && (
              <div className="absolute bottom-20 right-4 grid grid-cols-3 gap-1.5 sm:right-6" aria-label="Steering pad">
                {[
                  { k: "up", label: "Forward", glyph: "▲", col: 2, row: 1, v: { f: 1, t: 0 } },
                  { k: "left", label: "Turn left", glyph: "◀", col: 1, row: 2, v: { f: 0.5, t: 1 } },
                  { k: "right", label: "Turn right", glyph: "▶", col: 3, row: 2, v: { f: 0.5, t: -1 } },
                  { k: "down", label: "Back", glyph: "▼", col: 2, row: 2, v: { f: -0.5, t: 0 } },
                ].map((b) => (
                  <button
                    key={b.k}
                    aria-label={b.label}
                    style={{ gridColumn: b.col, gridRow: b.row }}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      if (!runningRef.current) play();
                      steer.current = b.v;
                      sendSteer();
                    }}
                    onPointerUp={() => {
                      steer.current = { f: 0, t: 0 };
                      sendSteer();
                    }}
                    onPointerCancel={() => {
                      steer.current = { f: 0, t: 0 };
                      sendSteer();
                    }}
                    className="grid h-12 w-12 touch-none select-none place-items-center rounded-[10px] bg-white/85 text-[18px] text-ink shadow active:bg-target"
                  >
                    {b.glyph}
                  </button>
                ))}
              </div>
            )}
            {mode === "manual" && !running && boot === "ready" && (
              <div className="pointer-events-none absolute inset-x-0 top-1/3 mx-auto w-fit rounded-[8px] bg-black/65 px-4 py-2 text-center text-[13.5px] text-white">
                Press W or hold the arrow pad to walk. A and D turn.
              </div>
            )}
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
              {running && status === "running" && (
                <button
                  onClick={() => simRef.current?.push(SHOVE_N, Math.random() * Math.PI * 2)}
                  title="Shove it from a random side, or click the robot to shove it from that side"
                  className="h-11 rounded-[10px] border border-fault/60 bg-fault/85 px-4 font-semibold text-white"
                >
                  Shove
                </button>
              )}
              {mode !== "manual" && (
              <button
                onClick={runTrials}
                disabled={boot !== "ready" || trialProgress != null || !placed.length}
                className="h-11 whitespace-nowrap rounded-[10px] border border-white/25 bg-black/40 px-3 font-semibold text-white disabled:opacity-50 sm:px-4"
              >
                <span className="sm:hidden">10 trials</span>
                <span className="hidden sm:inline">Run 10 trials</span>
              </button>
              )}
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
                {selMass != null && (
                  <div className="mt-2 flex justify-between text-[13px]">
                    <span className="text-ink-3">Mass</span>
                    <span className="tnum">{selMass < 1 ? `${Math.round(selMass * 1000)} g` : `${selMass.toFixed(1)} kg`}</span>
                  </div>
                )}
                {challenge ? (
                  <div className="mt-2 flex justify-between text-[13px]">
                    <span className="text-ink-3">Density (fixed in challenges)</span>
                    <span className="tnum">{defaultDensity(byId.get(sel.objectId))} kg/m³</span>
                  </div>
                ) : (
                  <label className="mt-3 block text-[13px]">
                    <span className="flex justify-between text-ink-3">
                      <span>Density</span>
                      <span className="tnum text-ink">{sel.density ?? defaultDensity(byId.get(sel.objectId))} kg/m³</span>
                    </span>
                    <input type="range" min={60} max={2400} step={20} value={sel.density ?? defaultDensity(byId.get(sel.objectId))} onChange={(e) => updateSel({ density: +e.target.value })} className="mt-1 w-full accent-[#141517]" />
                    <span className="text-[11.5px] text-ink-3">Foam 60 · wood 600 · water 1000 · rock 2400</span>
                  </label>
                )}
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
              <input
                type="checkbox"
                checked={hulls}
                onChange={(e) => {
                  setHulls(e.target.checked);
                  viewRef.current?.setShowHulls(e.target.checked);
                }}
                className="h-4 w-4 accent-[#2b59e8]"
              />
              Show what the robot feels (collision hulls)
            </label>
            {!challenge && (
              <label className="flex items-center gap-2 text-[13.5px]">
                <input type="checkbox" checked={pushes} onChange={(e) => setPushes(e.target.checked)} className="h-4 w-4 accent-[#141517]" />
                Shove the robot once per trial (170 N)
              </label>
            )}

            <ResultsSheet
              summary={trials}
              running={trialProgress}
              names={Object.fromEntries(placed.map((p) => [p.uid, p.name]))}
              mode={mode}
              onReplay={replay}
              replaying={replaying}
            />

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
            <button onClick={() => share()} disabled={!placed.length} className="h-10 w-full rounded-[10px] border border-ink/15 text-[14px] font-semibold hover:bg-ink/5 disabled:opacity-40 sm:hidden">
              Save and share
            </button>
          </div>
        </aside>
      </div>
      {naming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" role="dialog" aria-modal aria-label="Name your course" onClick={() => setNaming(false)}>
          <form
            className="sheet w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim() && title.trim() !== "Untitled course") share(true);
            }}
          >
            <div className="font-semibold">Name your course</div>
            <p className="mt-1 text-[13.5px] text-ink-3">It appears in the gauntlet with its pass rate.</p>
            <input
              autoFocus
              value={title === "Untitled course" ? "" : title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
              placeholder="Kitchen floor at night"
              className="mt-3 h-11 w-full rounded-[10px] border border-ink/15 bg-paper px-3 outline-none focus:border-route"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setNaming(false)} className="h-10 rounded-[10px] px-4 font-semibold text-ink-2 hover:bg-ink/5">
                Cancel
              </button>
              <button type="submit" disabled={!title.trim() || title.trim() === "Untitled course"} className="h-10 rounded-[10px] bg-target px-4 font-semibold disabled:opacity-45">
                Save and copy link
              </button>
            </div>
          </form>
        </div>
      )}
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
