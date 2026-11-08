import { createSim } from "@/sim/client";
import type { ArenaSim, FrameHeader } from "./simAdapter";
import type { FrameLayout, SceneSpec } from "@/sim/types";

export function create(): ArenaSim {
  const sim = createSim();
  let scene: SceneSpec | null = null;
  let lastTrials: import("@/sim/types").TrialOptions | null = null;
  const frameCbs = new Set<(buf: Float32Array, layout: FrameLayout, h: FrameHeader) => void>();
  let raf = 0;
  let lastP: [number, number] | null = null;
  let lastT = 0;
  let speed = 0;

  const loop = () => {
    const f = sim.latest();
    if (f && frameCbs.size) {
      const h = f.header;
      const p: [number, number] = [h.robotPelvis[0], h.robotPelvis[1]];
      if (lastP && h.simTime > lastT) {
        const v = Math.hypot(p[0] - lastP[0], p[1] - lastP[1]) / (h.simTime - lastT);
        speed = speed * 0.85 + v * 0.15;
      } else if (h.simTime < lastT) speed = 0;
      lastP = p;
      lastT = h.simTime;
      const header: FrameHeader = { t: h.simTime, status: h.status, pelvis: h.robotPelvis, speed, contacts: h.contactCount };
      // poses start right after the header: [robot geoms | objects | movers]
      const layout = { ...f.layout, header: 0 };
      frameCbs.forEach((cb) => cb(f.poses, layout, header));
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    async init() {
      const r = await sim.ready;
      return { robotVisuals: r.robotVisuals };
    },
    async setScene(s) {
      scene = s;
      const r = await sim.setScene(s);
      return r.layout;
    },
    setMode(m) {
      sim.setMode(m);
    },
    setCommand(c) {
      sim.setCommand(c);
    },
    play() {
      sim.play();
    },
    pause() {
      sim.pause();
    },
    reset() {
      sim.reset();
      speed = 0;
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onContact(cb) {
      return sim.onContact(cb);
    },
    async path() {
      const p = await sim.getPlan();
      return p ? Array.from(p) : null;
    },
    async runTrials(opts, onProgress) {
      const s = opts.scene ?? scene;
      if (!s) throw new Error("No course to test yet");
      lastTrials = { ...opts, scene: s };
      return sim.runTrials(lastTrials, (done, _n, r) => onProgress?.(done, r));
    },
    async replay(index) {
      if (!lastTrials) return null;
      speed = 0;
      return sim.replayTrial(lastTrials, index);
    },
    onPush(cb) {
      return sim.onPush(cb);
    },
    dispose() {
      cancelAnimationFrame(raf);
      sim.dispose();
    },
  };
}
