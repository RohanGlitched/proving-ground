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
const C = {
  moving: [['cardboard-box', 1.4, 0.05, 0.2], ['suitcase', 2.3, -0.2, 1.4], ['cardboard-box', 3.1, 0.15, 0.9]],
};
const all3 = [['cinder-block', 1.4, 0.9, 0.3], ['sandbag', 2.3, -0.95, 1.5], ['cinder-block', 3.2, 1.0, 1.1]];
console.log('building all moved', await rate(all3, 5), await rate(all3, 77));
const rot = [['cinder-block', 1.4, 0.0, 0.3], ['sandbag', 2.3, -0.05, 0.0], ['cinder-block', 3.2, 0.1, 1.1]];
console.log('building sandbag turned along the path', await rate(rot, 5), await rate(rot, 77));
for (const [name, objs] of Object.entries(C)) {
  console.log(name, 'as is', await rate(objs, 5), await rate(objs, 77));
  for (let i = 0; i < objs.length; i++) {
    const m = objs.map((o, k) => (k === i ? [o[0], o[1], o[2] + 0.9, o[3]] : o));
    console.log(`  move ${objs[i][0]}#${i}:`, await rate(m, 5), await rate(m, 77));
    for (let j = i + 1; j < objs.length; j++) {
      const m2 = m.map((o, k) => (k === j ? [o[0], o[1], o[2] - 0.9, o[3]] : o));
      console.log(`    + ${objs[j][0]}#${j}:`, await rate(m2, 5), await rate(m2, 77));
    }
  }
}
