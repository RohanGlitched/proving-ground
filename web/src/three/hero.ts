// The home page's live camera: library objects materialize in front of the robot, then Unitree's
// walking controller tries to get to the flag. Real physics, real controller, on a loop.
import * as THREE from "three";
import { showcase } from "@/lib/samples";
import { getLibrary, getPhysics, objectUrl, type LibraryEntry } from "@/lib/client/api";
import { tripIndex } from "@/lib/client/trips";
import type { ArenaView } from "./arenaView";
import type { SceneSpec, TrialOptions, TrialResult } from "@/sim/types";
import { STANDING_POSES, STANDING_VISUALS } from "@/components/home/heroStandingPose";

export type HeroStatus = {
  phase: "loading" | "making" | "walking" | "result";
  object?: string;
  speed?: number;
  contacts?: number;
  result?: "goal" | "fell" | "timeout";
  on?: string;
  round?: number;
};

const GOAL = { x: 4.2, y: 0 };
const START = { x: 0, y: 0, yaw: 0 };

// The opening shot: the cardboard box (the trip test has it tripping the robot 6 times in 10) at a
// spot where this exact blind walk trips on it under 3 s in. It runs as a trial replay with no
// jitter, so the browser plays back the same physics step for step. Checked offline with the sim
// engine: at x 0.77, y 0, yaw 0.9 the robot falls at 2.73 s, and so does every placement 5 cm or
// 0.15 rad either side. If the library ever changes the box, it is simply a different walk.
const OPENING = { slug: "cardboard-box", x: 0.77, y: 0, yaw: 0.9 };
const OPENING_TRIAL: Omit<TrialOptions, "scene"> = {
  n: 1,
  seed: 1,
  mode: "blind",
  jitter: { startPos: 0, startYaw: 0, objectPos: 0, objectYaw: 0 },
  maxSeconds: 10,
};
/** the opening build plays this much faster so the walk can start sooner */
const OPENING_BUILD_SPEED = 1.8;

// courses the hero cycles through afterwards: slots in front of the robot (MuJoCo xy)
const LAYOUTS: { x: number; y: number; yaw: number }[][] = [
  [{ x: 1.5, y: 0.05, yaw: 0.4 }],
  [{ x: 1.3, y: -0.2, yaw: 1.2 }, { x: 2.4, y: 0.25, yaw: 0.2 }],
  [{ x: 1.6, y: 0.1, yaw: 2.4 }, { x: 2.6, y: -0.3, yaw: 0.9 }, { x: 3.2, y: 0.35, yaw: 0 }],
];

// camera rig: offset from the look point (three.js, Y up), and how much course must fit across
const RIG = new THREE.Vector3(-2.4, 0.9, 3.6);
const SPAN = 2.2; // metres of course that must fit across the frame
const ROBOT_BAND = 1.9; // metres of height (robot plus margin) that must fit in the action band

export function startHero(canvas: HTMLCanvasElement, onStatus: (s: HeroStatus) => void) {
  let disposed = false;
  let view: ArenaView | null = null;
  let sim: import("@/sim/client").SimClient | null = null;
  let simTime: number | null = null;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // only very weak devices skip the physics; phones run the real controller too
  const light = (navigator.hardwareConcurrency ?? 8) < 4;

  (async () => {
    // everything slow starts at once: the physics worker, the library, the trip index, the 3D view
    const simReady = light
      ? null
      : import("@/sim/client").then(({ createSim }) => {
          if (disposed) return null;
          const c = createSim();
          sim = c;
          return c.ready.then((init) => ({ client: c, init }));
        });
    simReady?.catch(() => undefined);
    const library = getLibrary().catch(() => [] as LibraryEntry[]);
    const trips = tripIndex();
    const { ArenaView } = await import("./arenaView");
    if (disposed) return;
    view = new ArenaView(canvas);
    view.editable = false;
    if (view.stage.controls) view.stage.controls.enabled = false;
    view.setGoal(GOAL.x, GOAL.y);
    view.setStart(START.x, START.y, START.yaw);
    const cam = view.stage.camera;
    const baseFov = cam.fov;
    const pelvis = new THREE.Vector3(0, 0.55, 0);
    const look = new THREE.Vector3(0.55, 0.55, 0);
    const want = new THREE.Vector3();
    let orbit = 0;
    let settled = false;

    /** where the action sits on screen (view offset) and how much of the height it may use, from the canvas shape */
    const framing = () => {
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      // wide: the headline sits bottom-left, so the course plays in the upper right of the frame
      if (w >= 1200 && w / h >= 1.4) return { w, h, ox: -Math.round(w * 0.2), oy: Math.round(h * 0.1), frac: 0.75 };
      // smaller landscape windows: the headline spans most of the width, so the course plays above it
      if (w / h >= 1) return { w, h, ox: -Math.round(w * 0.16), oy: Math.round(h * 0.26), frac: 0.38 };
      // portrait: the headline fills the bottom half, so the course plays in the top ~45%
      return { w, h, ox: 0, oy: Math.round(h * 0.21), frac: 0.42 };
    };
    const place = (snap: boolean) => {
      const f = framing();
      // pull back until SPAN metres of course fit across the frame and the robot fits its band of the height
      const tanV = Math.tan(THREE.MathUtils.degToRad(baseFov / 2));
      const needW = SPAN / 2 / Math.max(0.05, tanV * (f.w / f.h)) / 0.83; // 0.83: the course runs diagonally to the camera
      const needH = ROBOT_BAND / f.frac / 2 / tanV;
      const need = Math.max(needW, needH);
      const scale = Math.max(1, need / RIG.length());
      want.set(RIG.x + Math.sin(orbit) * 0.9, RIG.y, RIG.z + Math.cos(orbit) * 0.4 - 0.4).multiplyScalar(scale).add(look);
      if (snap) cam.position.copy(want);
      else cam.position.lerp(want, 0.03);
      cam.lookAt(look);
      // the stage's (disabled) orbit controls still aim the camera at their target every frame
      view!.stage.controls?.target.copy(look);
      if (f.ox || f.oy) {
        if (!cam.view || cam.view.offsetX !== f.ox || cam.view.offsetY !== f.oy || cam.view.fullWidth !== f.w || cam.view.fullHeight !== f.h)
          cam.setViewOffset(f.w, f.h, f.ox, f.oy, f.w, f.h);
      } else if (cam.view) cam.clearViewOffset();
    };
    place(true);
    view.stage.onFrame((dt) => {
      orbit += dt * (reduced ? 0 : 0.05);
      // cinematic follow: stay beside and slightly behind the robot, drift around it slowly
      const f = sim?.latest();
      if (f) {
        const p = f.header.robotPelvis;
        pelvis.lerp(new THREE.Vector3(p[0], 0.55, -p[1]), 0.06);
        simTime = f.header.simTime;
      }
      // aim between the robot and what is in front of it; follow it, but not all the way
      look.lerp(new THREE.Vector3(0.55 + pelvis.x * 0.7, 0.55, pelvis.z * 0.7), 0.05);
      place(!settled);
      settled = true;
    });

    // library objects with parts
    const items = (await library).filter((e) => e.kind === "object");
    if (disposed) return;
    if (!items.length) {
      const sc = await showcase();
      if (sc) await view.upsertObject({ uid: "show", objectId: sc.entry.id, name: sc.entry.name, x: 1.5, y: 0, yaw: 0.4 }, sc.url);
      onStatus({ phase: "making", object: sc?.entry.name });
      return;
    }
    if (light) {
      // weak devices: no physics, just the build in front of the standing robot
      const e = items.find((i) => i.parts > 2) ?? items[0];
      void view.setRobot(STANDING_VISUALS);
      view.stage.onFrame(() => view?.applyFrame(STANDING_POSES, 0, STANDING_VISUALS.length));
      // replay the Lux3D build on a loop
      for (let r = 0; !disposed; r++) {
        await view.upsertObject({ uid: `show${r}`, objectId: e.id, name: e.name, x: 1.1, y: 0, yaw: 0.4 }, objectUrl(e.id, "visual.glb"));
        onStatus({ phase: "making", object: e.name });
        await wait(7000);
        view.removeObject(`show${r}`);
      }
      return;
    }

    // ---- the opening: start materializing the box right away, the robot joins as soon as it loads ----
    const tripMap = await trips;
    const box = items.find((i) => i.slug === OPENING.slug);
    // without the box, open on whatever trips the robot most often in the trip test
    const tripper = box ?? [...items].filter((i) => tripMap[i.id]).sort((a, b) => tripMap[b.id].falls - tripMap[a.id].falls)[0] ?? items[0];
    const at = box ? OPENING : { x: 1.4, y: 0, yaw: 0.3 };
    const first = { uid: "h0-0", objectId: tripper.id, name: tripper.name, x: at.x, y: at.y, yaw: at.yaw };
    const physFirst = getPhysics(first.objectId);
    physFirst.catch(() => undefined);
    view.setOrder([]);
    let buildT0 = performance.now();
    const built = view.upsertObject(first, objectUrl(first.objectId, "visual.glb"), { instant: reduced }).then(
      () => void (buildT0 = performance.now()),
      () => undefined,
    );
    onStatus({ phase: "making", object: first.name, round: 0 });
    // play the opening build a little faster (the view advances it at 1x; add the rest here)
    const offBoost = view.stage.onFrame((dt) => {
      const mat = (view as unknown as { objects?: Map<string, { mat: { done: boolean; update(dt: number): void } | null }> }).objects?.get(first.uid)?.mat;
      if (mat && !mat.done) mat.update(dt * (OPENING_BUILD_SPEED - 1));
    });

    // the robot stands on its pad while the physics loads (the sim's own reset pose, drawn ahead of time)
    void view.setRobot(STANDING_VISUALS);
    const offStanding = view.stage.onFrame(() => view?.applyFrame(STANDING_POSES, 0, STANDING_VISUALS.length));

    const ready = await simReady;
    offStanding();
    if (disposed || !ready) return;
    const s = ready.client;
    const sameRobot =
      ready.init.robotVisuals.length === STANDING_VISUALS.length && ready.init.robotVisuals.every((v, i) => v.mesh === STANDING_VISUALS[i].mesh && v.body === STANDING_VISUALS[i].body);
    if (!sameRobot) void view.setRobot(ready.init.robotVisuals);
    const offFrame = view.stage.onFrame(() => {
      const f = s.latest();
      if (f && view) view.applyFrame(f.poses, 0, f.layout.robotGeoms);
    });
    const names = new Map<string, string>();
    let lastTouch: string | null = null;
    s.onContact((c) => {
      view?.flashContact(c.entityId);
      lastTouch = c.entityId;
    });

    let round = 0;
    // shuffle deterministically by day so returning visitors see a different second act
    const order = [...items].filter((i) => i.id !== first.objectId).sort((a, b) => a.id.localeCompare(b.id));
    let k = new Date().getUTCDate() % Math.max(1, order.length);
    while (!disposed) {
      let placements: { uid: string; objectId: string; name: string; x: number; y: number; yaw: number }[];
      if (round === 0) placements = [first];
      else {
        const layout = LAYOUTS[(round - 1) % LAYOUTS.length];
        placements = layout.map((slot, i) => {
          const e = order[(k + i) % order.length] ?? first;
          return { uid: `h${round}-${i}`, objectId: e.id, name: e.name, x: slot.x, y: slot.y, yaw: slot.yaw };
        });
        k = (k + layout.length) % Math.max(1, order.length);
      }
      names.clear();
      lastTouch = null;
      placements.forEach((p) => names.set(p.uid, p.name));
      const label = placements.map((p) => p.name).join(", ");
      const phys = await Promise.all(placements.map((p) => getPhysics(p.objectId))).catch(() => null);
      if (disposed) break;
      if (!phys) {
        round++;
        await wait(1000);
        continue;
      }
      const scene: SceneSpec = {
        objects: placements.map((p, i) => ({ id: p.uid, name: p.name, parts: phys[i].parts, x: p.x, y: p.y, yaw: p.yaw, mass: phys[i].volume ? phys[i].volume! * 400 : undefined })),
        goal: GOAL,
        start: START,
      };
      await s.pause();
      if (round > 0) view.setOrder([]); // hold the old course still while the new scene compiles
      await s.setScene(scene);
      await s.reset();
      // the last course leaves as the robot stands back up on its pad
      if (round > 0) view.clearObjects();
      view.setOrder(placements.map((p) => p.uid));
      onStatus({ phase: "making", object: label, round });
      if (round > 0) {
        for (const p of placements) void view.upsertObject(p, objectUrl(p.objectId, "visual.glb"), { instant: reduced });
        await wait(reduced ? 600 : 4600);
      } else {
        // the robot sets off once the shape has condensed; it reaches the box after the build closes up
        await built;
        const go = buildT0 + (reduced ? 300 : 1200);
        await wait(Math.max(0, go - performance.now()));
      }
      if (disposed) break;
      // a replayed trial is exactly the trial the physics ran offline; afterwards, live blind walks
      let replay: Promise<TrialResult | null> | null = null;
      let replayed: TrialResult | null | undefined;
      if (round === 0) {
        replay = s.replayTrial({ ...OPENING_TRIAL, scene }, 0, { tail: 1.6 });
        replay.then(
          (r) => (replayed = r),
          () => (replayed = null),
        );
      } else {
        await s.setMode("blind");
        await s.play();
      }
      onStatus({ phase: "walking", object: label, round });
      const t0 = performance.now();
      let result: HeroStatus["result"] = "timeout";
      while (!disposed) {
        await wait(100);
        const f = s.latest();
        if (f) onStatus({ phase: "walking", object: label, contacts: f.header.contactCount, round });
        const st = f?.header.status ?? replayed?.result;
        if (st === "fell" || replayed?.result === "fell") {
          result = "fell";
          break;
        }
        if (st === "goal" || replayed?.result === "goal") {
          result = "goal";
          break;
        }
        if (replayed !== undefined) break;
        if ((f && f.header.simTime > 16) || performance.now() - t0 > 22000) break;
      }
      if (disposed) break;
      if (result === "fell") view.impact();
      const cause = replayed?.fallCause ?? lastTouch;
      onStatus({ phase: "result", result, on: result === "fell" && cause ? names.get(cause) : undefined, round, object: label, contacts: s.latest()?.header.contactCount });
      const shown = performance.now();
      if (replay) await replay.catch(() => null);
      await wait(Math.max(0, (result === "fell" ? 3200 : 2200) - (performance.now() - shown)));
      await s.pause();
      if (round === 0) offBoost();
      round++;
    }
    offFrame();
  })().catch((e) => console.error("hero", e));

  return {
    clock: () => simTime,
    dispose: () => {
      disposed = true;
      sim?.dispose();
      view?.dispose();
    },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
