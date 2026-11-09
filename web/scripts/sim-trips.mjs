// "Trip test": every library object, alone 1.4 m ahead of the robot, ten seeded blind walks.
// Prints and writes public/trip-index.json { objectId: { passes, falls, timeouts, blocked, n, mass } }.
// Run: node --import tsx scripts/sim-trips.mjs [baseUrl]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultDensity } from '../src/lib/density.ts';
import { makeEngine, WEB } from '../tests/sim/helpers.mjs';

const base = process.argv[2] || 'https://proving-ground-snowy.vercel.app';
const lib = await (await fetch(`${base}/api/library`)).json();
const items = lib.items.filter((i) => i.kind === 'object' || i.kind === 'articulated');
const e = await makeEngine('/trips');
const out = {};
const rows = [];
for (const it of items) {
  const doc = await (await fetch(`${base}/api/objects/${it.id}/parts.json`)).json();
  const parts = doc.parts.map((p) => {
    const s = p.points, o = new Float32Array(s.length);
    for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; }
    return { points: o, name: p.name, ...(p.volume > 0 ? { meshVolume: p.volume } : {}) };
  });
  const mass = doc.volume ? Math.min(80, Math.max(0.05, doc.volume * defaultDensity(it))) : undefined; // the engine clamps mass to 0.05..80 kg
  const scene = { objects: [{ id: it.id, name: it.name, parts, x: 1.4, y: 0, yaw: it.kind === 'articulated' ? -1.5708 : 0.3, mass, ...(doc.joints?.length ? { joints: doc.joints } : {}) }], goal: { x: 3.6, y: 0 }, start: { x: 0, y: 0, yaw: 0 } };
  const s = e.runTrials({ scene, n: 10, seed: 11, mode: 'blind', jitter: { startPos: 0.1, startYaw: 0.17, objectPos: 0.1, objectYaw: 0.6 }, maxSeconds: 14 });
  const falls = s.trials.filter((t) => t.result === 'fell').length;
  const timeouts = s.trials.filter((t) => t.result === 'timeout').length;
  const passes = s.trials.filter((t) => t.result === 'goal').length;
  const touched = s.trials.filter((t) => t.contacts.length > 0).length;
  // the same course with the planner: does a map of the footprints get it past?
  const sp = e.runTrials({ scene, n: 10, seed: 11, mode: 'planner', jitter: { startPos: 0.1, startYaw: 0.17, objectPos: 0.1, objectYaw: 0.6 }, maxSeconds: 20 });
  const planner = { passes: sp.trials.filter((t) => t.result === 'goal').length, falls: sp.trials.filter((t) => t.result === 'fell').length, timeouts: sp.trials.filter((t) => t.result === 'timeout').length };
  out[it.id] = { slug: it.slug, name: it.name, n: 10, passes, falls, timeouts, touched, mass: e.lastMasses?.[0] ?? mass ?? null, seed: 11, planner };
  rows.push({ name: it.name, parts: it.parts, mass: mass ? +mass.toFixed(2) : '?', passes, falls, timeouts, touched, planner: planner.passes, wallMs: Math.round(s.wallMs) });
}
console.table(rows);
await writeFile(path.join(WEB, 'public', 'trip-index.json'), JSON.stringify({ generatedAt: Date.now(), method: 'object 1.4 m ahead, 10 seeded blind walks (and 10 with the planner, 20 s limit), start jitter 10 cm / 10 deg, object jitter 10 cm / 34 deg, 14 s limit', items: out }, null, 1));
console.log('wrote public/trip-index.json');
