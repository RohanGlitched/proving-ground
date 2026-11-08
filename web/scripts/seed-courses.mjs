// Seeds the gauntlet with a few starter courses: builds each from library objects, runs ten seeded
// trials on the same engine the browser uses, then saves the course and its result through the public API.
// Run: node --import tsx scripts/seed-courses.mjs [baseUrl] [--dry]
import { makeEngine } from '../tests/sim/helpers.mjs';

const base = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://proving-ground-snowy.vercel.app';
const dry = process.argv.includes('--dry');
const lib = (await (await fetch(`${base}/api/library`)).json()).items;
const bySlug = (s) => lib.find((i) => i.slug === s);

const COURSES = [
  { title: 'Kitchen floor', mode: 'blind', pushes: false, objects: [['kitchen-chair', 1.5, 0.1, 0.5], ['sneaker', 2.4, -0.2, 1.2], ['traffic-cone', 3.1, 0.25, 0]] },
  { title: 'Bench in the way', mode: 'blind', pushes: false, objects: [['park-bench', 1.9, 0.05, 1.45]] },
  { title: 'Bench in the way (planner)', mode: 'planner', pushes: false, objects: [['park-bench', 1.9, 0.05, 1.45]] },
  { title: 'Cone slalom with shoves', mode: 'blind', pushes: true, objects: [['traffic-cone', 1.3, 0.3, 0], ['traffic-cone', 2.1, -0.3, 0], ['traffic-cone', 2.9, 0.3, 0], ['traffic-cone', 3.7, -0.3, 0]] },
  { title: 'Laundry day', mode: 'blind', pushes: false, objects: [['laundry-basket', 1.6, 0.0, 0.3], ['cardboard-box', 2.6, 0.3, 0.8], ['stack-of-books', 3.2, -0.25, 0.2]] },
  { title: 'Garage', mode: 'blind', pushes: true, objects: [['car-tire', 1.5, 0.0, 0], ['toolbox', 2.4, -0.3, 0.6], ['bucket', 3.1, 0.3, 0]] },
];

const e = await makeEngine('/seed');
async function physics(id) {
  const doc = await (await fetch(`${base}/api/objects/${id}/parts.json`)).json();
  const parts = doc.parts.map((p) => {
    const s = p.points, o = new Float32Array(s.length);
    for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; }
    return { points: o, name: p.name };
  });
  return { parts, volume: doc.volume ?? null };
}

for (const c of COURSES) {
  const objs = c.objects.map(([slug, x, y, yaw]) => ({ e: bySlug(slug), x, y, yaw })).filter((o) => o.e);
  if (objs.length < c.objects.length) { console.log(`skip "${c.title}": missing ${c.objects.length - objs.length} objects`); continue; }
  const sceneObjects = [];
  for (const [i, o] of objs.entries()) {
    const ph = await physics(o.e.id);
    sceneObjects.push({ id: `o${i}`, name: o.e.name, parts: ph.parts, x: o.x, y: o.y, yaw: o.yaw, mass: ph.volume ? ph.volume * 400 : undefined });
  }
  const seed = 1000 + COURSES.indexOf(c);
  const goal = { x: 4.5, y: 0 };
  const s = e.runTrials({ scene: { objects: sceneObjects, goal, start: { x: 0, y: 0, yaw: 0 } }, n: 10, seed, mode: c.mode, pushes: c.pushes ? { count: 1, force: 120 } : null, maxSeconds: 20 });
  const pass = s.trials.filter((t) => t.result === 'goal').length;
  console.log(`${c.title}: ${pass}/10 (${c.mode}${c.pushes ? ', shoves' : ''})`);
  if (dry) continue;
  const doc = {
    title: c.title,
    objects: objs.map((o) => ({ objectId: o.e.id, name: o.e.name, x: o.x, y: o.y, yaw: o.yaw })),
    start: { x: 0, y: 0, yaw: 0 },
    goal,
    mode: c.mode,
    pushes: c.pushes,
    best: { passRate: s.passRate, trials: 10, seed },
  };
  const r = await fetch(`${base}/api/courses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
  const { id } = await r.json();
  await fetch(`${base}/api/courses/${id}/results`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passRate: s.passRate, trials: 10, seed, mode: c.mode }) });
  console.log('  saved', `${base}/c/${id}`);
}
