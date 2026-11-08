// Door on a hinge in the robot's path: does the robot push it open? Prints hinge angle over time.
import { makeEngine } from '../tests/sim/helpers.mjs';
const base = 'https://proving-ground-snowy.vercel.app';
const lib = (await (await fetch(`${base}/api/library`)).json()).items;
const slug = process.argv[2] ?? 'door';
const it = lib.find((e) => e.slug === slug);
const doc = await (await fetch(`${base}/api/objects/${it.id}/parts.json?v=2`)).json();
const parts = doc.parts.map((p) => { const s = p.points, o = new Float32Array(s.length); for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; } return { points: o, meshVolume: p.volume }; });
console.log(slug, 'joints', JSON.stringify(doc.joints), 'size', it.size);
const yaw = +(process.argv[3] ?? Math.PI / 2), off = +(process.argv[4] ?? 0);
const e = await makeEngine('/door');
const scene = { objects: [{ id: 'd', name: it.name, parts, x: 1.6, y: off, yaw, mass: doc.volume * 400, joints: doc.joints }], goal: { x: 3.5, y: 0 }, start: { x: 0, y: 0, yaw: 0 } };
const r = e.setScene(scene);
console.log('layout hinges', JSON.stringify(r.layout.hinges?.map((h) => h.joint.child)), 'len', r.layout.length);
e.reset({ noise: 'none' }); e.setMode('blind');
const buf = new Float32Array(r.layout.length);
for (let t = 0; t < 30; t++) {
  e.step(500);
  e.writeFrame(buf);
  const p = e.robotPose();
  { const mj = e.mujoco, m = e.model, d = e.data, cv = d.contact, n = cv.size(); const seen = new Set();
    for (let i = 0; i < n; i++) { const c = cv.get(i); const a = mj.mj_id2name(m, mj.mjtObj.mjOBJ_GEOM.value, c.geom1) || 'g' + c.geom1, b = mj.mj_id2name(m, mj.mjtObj.mjOBJ_GEOM.value, c.geom2) || 'g' + c.geom2; if ((a + b).includes('pg_')) seen.add(a + '|' + b + '@' + Array.from(c.pos).map((v) => v.toFixed(2)).join(',')); c.delete(); }
    if (seen.size) console.log('   door contacts', [...seen].join('  ')); }
  console.log((t + 1) + 's', e.status, 'robot', p.x.toFixed(2), p.y.toFixed(2), 'hinge', buf[buf.length - 1].toFixed(3), 'contacts', e.contacts.length);
  if (e.status !== 'running') break;
}
console.log('last contacts', JSON.stringify(e.contacts.slice(-4)));
const d = e.data, m = e.model;
const mj = e.mujoco; const cv = d.contact;
for (let i = 0; i < d.ncon; i++) { const c = cv.get ? cv.get(i) : cv[i]; const n1 = mj.mj_id2name(m, mj.mjtObj.mjOBJ_GEOM.value, c.geom1), n2 = mj.mj_id2name(m, mj.mjtObj.mjOBJ_GEOM.value, c.geom2); console.log('contact', n1, n2, Array.from(c.pos).map((v) => v.toFixed(2)).join(',')); }
const B = mj.mjtObj.mjOBJ_BODY.value; for (const nm of ['pg_o0', 'pg_o0_c0']) { const b = mj.mj_name2id(m, B, nm); console.log(nm, Array.from(d.xpos.slice(3 * b, 3 * b + 3)).map((v) => v.toFixed(2)).join(',')); }
