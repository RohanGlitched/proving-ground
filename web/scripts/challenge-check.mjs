// Checks that each "fix" challenge can be solved: tries moving up to N objects 0.9 m off the line and runs ten trials.
import { defaultDensity } from '../src/lib/density.ts';
import { makeEngine } from '../tests/sim/helpers.mjs';
const base = 'https://proving-ground-snowy.vercel.app';
const lib = (await (await fetch(`${base}/api/library`)).json()).items;
const phys = new Map();
async function physics(e) {
  if (!phys.has(e.id)) {
    const doc = await (await fetch(`${base}/api/objects/${e.id}/parts.json`)).json();
    phys.set(e.id, { parts: doc.parts.map((p) => { const s = p.points, o = new Float32Array(s.length); for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; } return { points: o, ...(p.volume > 0 ? { meshVolume: p.volume } : {}) }; }), volume: doc.volume });
  }
  return phys.get(e.id);
}
const e = await makeEngine('/ch');
async function rate(objs, seed) {
  const objects = [];
  for (const [i, [slug, x, y, yaw]] of objs.entries()) { const it = lib.find((l) => l.slug === slug); const p = await physics(it); objects.push({ id: `o${i}`, parts: p.parts, x, y, yaw, mass: p.volume ? p.volume * defaultDensity(it) : undefined }); }
  const s = e.runTrials({ scene: { objects, goal: { x: 4.5, y: 0 }, start: { x: 0, y: 0, yaw: 0 } }, n: 10, seed, mode: 'blind', maxSeconds: 20 });
  return s.trials.filter((t) => t.result === 'goal').length;
}
const M = [['cardboard-box', 1.4, 0.05, 0.2], ['suitcase', 2.3, -0.2, 1.4], ['cardboard-box', 3.1, 0.15, 0.9]];
const T = [['teddy-bear', 1.4, 0.1, 0.4], ['toy-truck', 2.2, -0.15, 1.2], ['block-pile', 2.9, 0.1, 0], ['toy-train', 3.6, -0.1, 0.3]];
const mv = (o, k, dy) => o.map((q, i) => (i === k ? [q[0], q[1], q[2] + dy, q[3]] : q));
const S1 = 673365, S2 = 962290;
console.log('moving day as is', await rate(M, S1), '| box0+suitcase', await rate(mv(mv(M, 0, 0.9), 1, -0.9), S1), '| box0+box2', await rate(mv(mv(M, 0, 0.9), 2, -0.9), S1), '| box0 only', await rate(mv(M, 0, 0.9), S1));
console.log('toddler as is', await rate(T, S2), '| block pile', await rate(mv(T, 2, 0.9), S2), '| truck', await rate(mv(T, 1, 0.9), S2));
