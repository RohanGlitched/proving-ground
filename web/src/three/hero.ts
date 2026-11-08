// The home page's live camera: library objects materialize in front of the robot, then Unitree's
// walking controller tries to get to the flag. Real physics, real controller, on a loop.
import * as THREE from "three";
import { showcase } from "@/lib/samples";
import { getLibrary, getPhysics, objectUrl, type LibraryEntry } from "@/lib/client/api";
import type { ArenaView } from "./arenaView";

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

// courses the hero cycles through: slots in front of the robot (MuJoCo xy)
const LAYOUTS: { x: number; y: number; yaw: number }[][] = [
  [{ x: 1.5, y: 0.05, yaw: 0.4 }],
  [{ x: 1.3, y: -0.2, yaw: 1.2 }, { x: 2.4, y: 0.25, yaw: 0.2 }],
  [{ x: 1.6, y: 0.1, yaw: 2.4 }, { x: 2.6, y: -0.3, yaw: 0.9 }, { x: 3.2, y: 0.35, yaw: 0 }],
];

export function startHero(canvas: HTMLCanvasElement, onStatus: (s: HeroStatus) => void) {
  let disposed = false;
  let view: ArenaView | null = null;
  let sim: import("@/sim/client").SimClient | null = null;
  let simTime: number | null = null;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const light = (navigator.hardwareConcurrency ?? 8) < 4 || window.innerWidth < 640;

  (async () => {
    const { ArenaView } = await import("./arenaView");
    if (disposed) return;
    view = new ArenaView(canvas);
    view.editable = false;
    if (view.stage.controls) view.stage.controls.enabled = false;
    view.setGoal(GOAL.x, GOAL.y);
    view.setStart(0, 0, 0);
    const cam = view.stage.camera;
    cam.position.set(-1.2, 1.5, 3.4);
    const look = new THREE.Vector3(1.2, 0.6, 0);
    const pelvis = new THREE.Vector3(0, 0.8, 0);
    let orbit = 0;
    view.stage.onFrame((dt) => {
      orbit += dt * (reduced ? 0 : 0.05);
      // cinematic follow: stay beside and slightly behind the robot, drift around it slowly
      const f = sim?.latest();
      if (f) {
        const p = f.header.robotPelvis;
        pelvis.lerp(new THREE.Vector3(p[0], 0.55, -p[1]), 0.06);
        simTime = f.header.simTime;
      }
      const target = new THREE.Vector3(pelvis.x + 0.7, 0.55, pelvis.z);
      look.lerp(target, 0.05);
      const want = new THREE.Vector3(look.x - 2.4 + Math.sin(orbit) * 0.9, 1.45, look.z + 3.6 + Math.cos(orbit) * 0.4);
      cam.position.lerp(want, 0.03);
      cam.lookAt(look);
      // the headline sits bottom-left: on wide screens render the action in the right part of the frame
      const c = view!.stage.renderer.domElement;
      const w = c.clientWidth, h = c.clientHeight;
      if (w >= 900) {
        const ox = -Math.round(w * 0.13);
        if (!cam.view || cam.view.offsetX !== ox || cam.view.fullWidth !== w || cam.view.fullHeight !== h) cam.setViewOffset(w, h, ox, 0, w, h);
      } else if (cam.view) cam.clearViewOffset();
    });

    // library objects with parts
    const items = (await getLibrary().catch(() => [] as LibraryEntry[])).filter((e) => e.kind === "object");
    if (!items.length) {
      const sc = await showcase();
      if (sc) await view.upsertObject({ uid: "show", objectId: sc.entry.id, name: sc.entry.name, x: 1.5, y: 0, yaw: 0.4 }, sc.url);
      onStatus({ phase: "making", object: sc?.entry.name });
      return;
    }
    if (light) {
      // phones: no physics, just the build
      const e = items.find((i) => i.parts > 2) ?? items[0];
      await view.upsertObject({ uid: "show", objectId: e.id, name: e.name, x: 1.4, y: 0, yaw: 0.4 }, objectUrl(e.id, "visual.glb"));
      onStatus({ phase: "making", object: e.name });
      return;
    }

    const { createSim } = await import("@/sim/client");
    if (disposed) return;
    sim = createSim();
    const init = await sim.ready;
    await view.setRobot(init.robotVisuals);
    view.setOrder([]);
    const offFrame = view.stage.onFrame(() => {
      const f = sim?.latest();
      if (f) view!.applyFrame(f.poses, 0, f.layout.robotGeoms);
    });
    const names = new Map<string, string>();
    let lastTouch: string | null = null;
    sim.onContact((c) => {
      view?.flashContact(c.entityId);
      lastTouch = c.entityId;
    });

    // shuffle deterministically by day so returning visitors see a different opening
    const order = [...items].sort((a, b) => a.id.localeCompare(b.id));
    let k = new Date().getUTCDate() % order.length;
    let round = 0;
    while (!disposed) {
      const layout = LAYOUTS[round % LAYOUTS.length];
      const chosen = layout.map((slot, i) => ({ ...slot, e: order[(k + i) % order.length] }));
      k = (k + layout.length) % order.length;
      view.clearObjects();
      names.clear();
      lastTouch = null;
      const placements = chosen.map((c, i) => ({ uid: `h${round}-${i}`, objectId: c.e.id, name: c.e.name, x: c.x, y: c.y, yaw: c.yaw }));
      placements.forEach((p) => names.set(p.uid, p.name));
      const phys = await Promise.all(placements.map((p) => getPhysics(p.objectId)));
      if (disposed) break;
      await sim.pause();
      await sim.setScene({ objects: placements.map((p, i) => ({ id: p.uid, name: p.name, parts: phys[i].parts, x: p.x, y: p.y, yaw: p.yaw, mass: phys[i].volume ? phys[i].volume! * 400 : undefined })), goal: GOAL, start: { x: 0, y: 0, yaw: 0 } });
      await sim.reset();
      view.setOrder(placements.map((p) => p.uid));
      onStatus({ phase: "making", object: placements.map((p) => p.name).join(", "), round });
      for (const p of placements) view.upsertObject(p, objectUrl(p.objectId, "visual.glb"), { instant: reduced });
      await wait(reduced ? 600 : 4600);
      if (disposed) break;
      await sim.setMode("blind");
      await sim.play();
      onStatus({ phase: "walking", object: placements.map((p) => p.name).join(", "), round });
      const t0 = performance.now();
      let result: HeroStatus["result"] = "timeout";
      while (!disposed) {
        await wait(200);
        const f = sim.latest();
        if (!f) continue;
        onStatus({ phase: "walking", object: placements.map((p) => p.name).join(", "), contacts: f.header.contactCount, round });
        if (f.header.status === "fell") {
          result = "fell";
          break;
        }
        if (f.header.status === "goal") {
          result = "goal";
          break;
        }
        if (f.header.simTime > 16 || performance.now() - t0 > 22000) break;
      }
      onStatus({ phase: "result", result, on: result === "fell" && lastTouch ? names.get(lastTouch) : undefined, round });
      await wait(result === "fell" ? 3200 : 2200);
      await sim.pause();
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
