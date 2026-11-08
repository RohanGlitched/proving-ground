// Starter course check: box + chair-ish + the jogger crossing at x=2.1. Blind vs planner, ten seeded trials each.
// Run: node --import tsx scripts/jogger-check.mjs [baseUrl]
import { makeEngine } from '../tests/sim/helpers.mjs';
const base = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://proving-ground-snowy.vercel.app';
const lib = (await (await fetch(`${base}/api/library`)).json()).items;
async function physics(id) {
  const doc = await (await fetch(`${base}/api/objects/${id}/parts.json`)).json();
  return { parts: doc.parts.map((p) => { const s = p.points, o = new Float32Array(s.length); for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; } return { points: o }; }), volume: doc.volume };
}
const WALK_SPAN = 2.4, FACE = Math.PI;
function crossingPath(x) { const leg = (2 * WALK_SPAN) / 0.9; return [{ x, y: -WALK_SPAN, yaw: FACE, t: 0 }, { x, y: WALK_SPAN, yaw: FACE, t: leg }, { x, y: WALK_SPAN, yaw: 0, t: leg + 0.6 }, { x, y: -WALK_SPAN, yaw: 0, t: 2 * leg + 0.6 }, { x, y: -WALK_SPAN, yaw: FACE, t: 2 * leg + 1.2 }]; }
const JX = +(process.env.JX ?? 2.1), PH = +(process.env.PH ?? 0);
function shift(keys, phase) { if (!phase) return keys; const T = keys[keys.length - 1].t; return keys.map((k) => ({ ...k, t: (k.t + phase * T) % T })).sort((a, b) => a.t - b.t); }
const box = lib.find((e) => e.slug === 'cardboard-box'), cone = lib.find((e) => e.slug === 'traffic-cone'), jog = lib.find((e) => e.kind === 'pedestrian');
const bp = await physics(box.id), cp = await physics(cone.id), jp = await physics(jog.id);
const objects = [
  { id: 'a', parts: bp.parts, x: 1.6, y: 0.02, yaw: 0.35, mass: bp.volume * 400 },
  { id: 'b', parts: cp.parts, x: 3.1, y: -0.08, yaw: 1.2, mass: cp.volume * 400 },
];
const e = await makeEngine('/jog');
for (const withJog of process.env.JX ? [true] : [false, true]) for (const mode of ['blind', 'planner']) {
  const scene = { objects, movers: withJog ? [{ id: "j", parts: jp.parts, path: shift(crossingPath(JX), PH), loop: true }] : [], goal: { x: 4.5, y: 0 }, start: { x: 0, y: 0, yaw: 0 } };
  const s = e.runTrials({ scene, n: 10, seed: 7, mode, pushes: null, maxSeconds: 25 });
  const r = s.trials.map((t) => t.result[0] + (t.result === 'goal' ? '' : t.time?.toFixed?.(1) ?? '')).join(' ');
  console.log(`${withJog ? 'jogger' : 'no-jog'} ${mode}: pass ${s.passRate * 100}%  ${r}`);
}
