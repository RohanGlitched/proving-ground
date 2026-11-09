// Seeds the gauntlet with a few starter courses: builds each from library objects, runs ten seeded
// trials on the same engine the browser uses, then saves the course and its result through the public API.
// Run: node --import tsx scripts/seed-courses.mjs [baseUrl] [--dry]
import { defaultDensity } from '../src/lib/density.ts';
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
  { title: "Toddler's room", mode: 'blind', pushes: false, objects: [['teddy-bear', 1.4, 0.1, 0.4], ['toy-truck', 2.2, -0.15, 1.2], ['block-pile', 2.9, 0.1, 0], ['toy-train', 3.6, -0.1, 0.3]] },
  { title: 'Moving day', mode: 'blind', pushes: false, objects: [['cardboard-box', 1.4, 0.05, 0.2], ['suitcase', 2.3, -0.2, 1.4], ['cardboard-box', 3.1, 0.15, 0.9]] },
  { title: 'Fruit bowl spill', mode: 'blind', pushes: false, objects: [['watermelon', 1.4, 0.05, 0], ['pumpkin', 2.2, -0.1, 0.5], ['pineapple', 2.9, 0.1, 0], ['banana-peel', 3.5, 0, 0.3]] },
  { title: 'Gym floor', mode: 'blind', pushes: false, objects: [['kettlebell', 1.4, 0.0, 0], ['football', 2.1, 0.15, 0], ['yoga-ball', 2.9, -0.2, 0], ['kettlebell', 3.5, 0.1, 0.8]] },
  { title: 'Building site', mode: 'blind', pushes: false, objects: [['cinder-block', 1.4, 0.0, 0.3], ['sandbag', 2.3, -0.05, 1.5], ['cinder-block', 3.2, 0.1, 1.1]] },
  { title: 'Building site (planner)', mode: 'planner', pushes: false, objects: [['cinder-block', 1.4, 0.0, 0.3], ['sandbag', 2.3, -0.05, 1.5], ['cinder-block', 3.2, 0.1, 1.1]] },
  { title: 'Curbside', mode: 'planner', pushes: false, objects: [['trash-can', 1.5, 0.25, 0], ['fire-hydrant', 2.3, -0.3, 0], ['bollard', 3.1, 0.2, 0]] },
  { title: 'Office after hours', mode: 'blind', pushes: true, objects: [['office-chair', 1.6, 0.1, 0.7], ['bar-stool', 2.6, -0.25, 0], ['floor-lamp', 3.4, 0.3, 0]] },
  { title: 'One banana peel', mode: 'blind', pushes: false, objects: [['banana-peel', 1.5, 0.0, 0.4]] },
  { title: 'The rolled rug', mode: 'blind', pushes: false, objects: [['rolled-rug', 1.8, 0.0, 1.57]] },
  { title: 'Push the door open', mode: 'blind', pushes: false, objects: [['door', 1.6, 0.0, -1.5708]] },
  { title: 'The gate opens the other way', mode: 'blind', pushes: false, objects: [['garden-gate', 1.6, 0.0, 1.5708]] },
  { title: 'Gate, then a cone', mode: 'blind', pushes: false, objects: [['garden-gate', 1.5, 0.0, -1.5708], ['traffic-cone', 2.8, 0.1, 0]] },
  { title: 'School run (planner)', mode: 'planner', pushes: false, objects: [['traffic-cone', 1.2, 0.35, 0], ['kid', 2.2, 0, 0, 'mover'], ['bollard', 3.3, -0.3, 0]] },
  { title: 'Lunch rush (planner)', mode: 'planner', pushes: false, objects: [['office-worker', 1.6, 0, 0, 'mover'], ['delivery-worker', 3.0, 0, 0, 'mover'], ['cardboard-box', 2.3, 0.4, 0.6]] },
  { title: 'Bin day (planner)', mode: 'planner', pushes: false, objects: [['wheelie-bin', 1.7, 0.1, 0.3], ['wheelie-bin', 2.9, -0.25, 1.0]] },
];

// same as ArenaApp.tsx: a walker crosses at x, from one side to the other and back, about 0.9 m/s
const WALK_SPAN = 2.4, FACE = Math.PI;
function crossingPath(x, phase = 0) {
  const leg = (2 * WALK_SPAN) / 0.9;
  const keys = [
    { x, y: -WALK_SPAN, yaw: FACE, t: 0 }, { x, y: WALK_SPAN, yaw: FACE, t: leg }, { x, y: WALK_SPAN, yaw: 0, t: leg + 0.6 },
    { x, y: -WALK_SPAN, yaw: 0, t: 2 * leg + 0.6 }, { x, y: -WALK_SPAN, yaw: FACE, t: 2 * leg + 1.2 },
  ];
  if (!phase) return keys;
  const T = keys[keys.length - 1].t, shift = (phase % 1) * T;
  return keys.map((k) => ({ ...k, t: (k.t + shift) % T })).sort((a, b) => a.t - b.t);
}

const existing = new Set(((await (await fetch(`${base}/api/courses?sort=new`)).json()).items ?? []).map((c) => c.title));
const e = await makeEngine('/seed');
async function physics(id) {
  const doc = await (await fetch(`${base}/api/objects/${id}/parts.json`)).json();
  const parts = doc.parts.map((p) => {
    const s = p.points, o = new Float32Array(s.length);
    for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; }
    return { points: o, name: p.name, ...(p.volume > 0 ? { meshVolume: p.volume } : {}) };
  });
  return { parts, volume: doc.volume ?? null, joints: doc.joints };
}

for (const c of COURSES) {
  if (process.env.ONLY && !c.title.startsWith(process.env.ONLY)) continue;
  if (existing.has(c.title)) { console.log(`skip "${c.title}": already in the gauntlet`); continue; }
  const objs = c.objects.map(([slug, x, y, yaw, kind]) => ({ e: bySlug(slug), x, y, yaw, kind: kind ?? 'object' })).filter((o) => o.e);
  if (objs.length < c.objects.length) { console.log(`skip "${c.title}": missing ${c.objects.length - objs.length} objects`); continue; }
  const sceneObjects = [];
  const movers = [];
  for (const [i, o] of objs.entries()) {
    const ph = await physics(o.e.id);
    // pedestrians cross the course the same way the arena makes them (crossingPath in ArenaApp.tsx)
    if (o.kind === 'mover') { movers.push({ id: `m${i}`, name: o.e.name, parts: ph.parts, path: crossingPath(o.x, movers.length * 0.37), loop: true }); continue; }
    sceneObjects.push({ id: `o${i}`, name: o.e.name, parts: ph.parts, x: o.x, y: o.y, yaw: o.yaw, mass: ph.volume ? ph.volume * defaultDensity(o.e) : undefined, ...(ph.joints?.length ? { joints: ph.joints } : {}) });
  }
  const seed = 1000 + COURSES.indexOf(c);
  const goal = { x: 4.5, y: 0 };
  const s = e.runTrials({ scene: { objects: sceneObjects, movers, goal, start: { x: 0, y: 0, yaw: 0 } }, n: 10, seed, mode: c.mode, pushes: c.pushes ? { count: 1, force: 120 } : null, maxSeconds: 20 });
  const pass = s.trials.filter((t) => t.result === 'goal').length;
  console.log(`${c.title}: ${pass}/10 (${c.mode}${c.pushes ? ', shoves' : ''})`);
  if (dry) console.log('  ' + s.trials.map((t) => t.result[0] + (t.time != null ? t.time.toFixed(1) : '')).join(' '));
  if (dry) continue;
  const doc = {
    title: c.title,
    objects: objs.map((o) => ({ objectId: o.e.id, name: o.e.name, x: o.x, y: o.y, yaw: o.yaw, ...(o.kind === 'mover' ? { kind: 'mover' } : {}) })),
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
