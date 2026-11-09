// Trace one planner trial on the Lunch rush layout: robot pose, yielding, walker positions every 0.5 s.
import { makeEngine } from '../tests/sim/helpers.mjs';
const base = 'https://proving-ground-snowy.vercel.app';
const lib = (await (await fetch(`${base}/api/library`)).json()).items;
async function physics(id) { const doc = await (await fetch(`${base}/api/objects/${id}/parts.json`)).json(); return { parts: doc.parts.map((p) => { const s = p.points, o = new Float32Array(s.length); for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; } return { points: o }; }), volume: doc.volume }; }
const W = 2.4, F = Math.PI;
function cross(x, ph) { const leg = (2 * W) / 0.9; let k = [{ x, y: -W, yaw: F, t: 0 }, { x, y: W, yaw: F, t: leg }, { x, y: W, yaw: 0, t: leg + 0.6 }, { x, y: -W, yaw: 0, t: 2 * leg + 0.6 }, { x, y: -W, yaw: F, t: 2 * leg + 1.2 }]; if (!ph) return k; const T = k.at(-1).t; return k.map((q) => ({ ...q, t: (q.t + ph * T) % T })).sort((a, b) => a.t - b.t); }
const slug = (s) => lib.find((e) => e.slug === s);
const a = await physics(slug(process.env.P1 ?? 'office-worker').id);
const scene = { objects: [], movers: [{ id: 'm0', parts: a.parts, path: cross(1.6, 0), loop: true }], goal: { x: 4.5, y: 0 }, start: { x: 0, y: 0, yaw: 0 } };
const e = await makeEngine('/trace');
e.setScene(scene);
const ent = e.entities.find((x) => x.mover);
console.log('radius', ent.radius.toFixed(2));
const run = e.beginTrial({ scene, n: 10, seed: 7, mode: 'planner', maxSeconds: 20 }, 0);
let k = 0;
while (!run.result) {
  e.advanceTrial(run, 250);
  if (k++ % 2) continue;
  const p = e.robotPose();
  console.log(e.time.toFixed(1), 'robot', p.x.toFixed(2), p.y.toFixed(2), 'yield', e.yielding, 'plan', e.plan ? e.plan.length / 2 : null);
}
console.log(run.result.result, run.result.time);
