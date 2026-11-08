// Trace one planner trial with the jogger: pose, yielding, plan length every 0.5 s.
import { makeEngine } from '../tests/sim/helpers.mjs';
const base = 'https://proving-ground-snowy.vercel.app';
const lib = (await (await fetch(`${base}/api/library`)).json()).items;
async function physics(id) { const doc = await (await fetch(`${base}/api/objects/${id}/parts.json`)).json(); return { parts: doc.parts.map((p) => { const s = p.points, o = new Float32Array(s.length); for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; } return { points: o }; }), volume: doc.volume }; }
const W = 2.4, F = Math.PI, JX = +(process.env.JX ?? 2.1), PH = +(process.env.PH ?? 0.25), IDX = +(process.env.IDX ?? 0);
const leg = (2 * W) / 0.9; let keys = [{ x: JX, y: -W, yaw: F, t: 0 }, { x: JX, y: W, yaw: F, t: leg }, { x: JX, y: W, yaw: 0, t: leg + 0.6 }, { x: JX, y: -W, yaw: 0, t: 2 * leg + 0.6 }, { x: JX, y: -W, yaw: F, t: 2 * leg + 1.2 }];
const T = keys.at(-1).t; keys = keys.map((k) => ({ ...k, t: (k.t + PH * T) % T })).sort((a, b) => a.t - b.t);
const box = lib.find((e) => e.slug === 'cardboard-box'), cone = lib.find((e) => e.slug === 'traffic-cone'), jog = lib.find((e) => e.kind === 'pedestrian');
const bp = await physics(box.id), cp = await physics(cone.id), jp = await physics(jog.id);
const scene = { objects: [{ id: 'a', parts: bp.parts, x: 1.6, y: 0.02, yaw: 0.35, mass: bp.volume * 400 }, { id: 'b', parts: cp.parts, x: 3.1, y: -0.08, yaw: 1.2, mass: cp.volume * 400 }], movers: [{ id: 'j', parts: jp.parts, path: keys, loop: true }], goal: { x: 4.5, y: 0 }, start: { x: 0, y: 0, yaw: 0 } };
const e = await makeEngine('/trace');
e.setScene(scene);
const run = e.beginTrial({ scene, n: 10, seed: 7, mode: 'planner', maxSeconds: 25 }, IDX);
while (!run.result) {
  e.advanceTrial(run, 250);
  const p = e.robotPose();
  console.log(e.time.toFixed(1), 'robot', p.x.toFixed(2), p.y.toFixed(2), 'yield', e.yielding, 'plan', e.plan ? e.plan.length / 2 : null, 'cmd', e.cmd?.vx?.toFixed?.(2));
}
console.log(run.result.result, run.result.time);
