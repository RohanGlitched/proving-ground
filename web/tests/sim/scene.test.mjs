// Movers, fixed objects, recompiles that keep the robot, frame layout, robot-ready export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, boxPart, loadAll, sample } from './helpers.mjs';
import { toMJCF, glbToParts } from '../../src/sim/assets.ts';
import { HEADER, H_FALLEN, H_PELVIS_X, H_TIME } from '../../src/sim/frame.ts';

test('a mover crossing the path touches the robot and is reported as a mover', async () => {
  const e = await makeEngine('/t_mover');
  // a 0.4 x 0.4 x 1.7 m "pedestrian" crossing x = 1.2 from y = -2 to y = 2; the robot walks blind
  const mover = { id: 'ped', name: 'pedestrian', parts: [boxPart(0.4, 0.4, 1.7)], path: [{ x: 1.2, y: -2, yaw: 0, t: 0 }, { x: 1.2, y: 2, yaw: 0, t: 5.5 }], loop: false };
  e.setScene({ objects: [], movers: [mover], goal: { x: 4, y: 0 } });
  e.setMode('blind');
  const seen = [];
  for (let k = 0; k < 40 && e.status === 'running'; k++) seen.push(...e.step(250).newContacts);
  assert.ok(seen.some((c) => c.entityId === 'ped' && c.kind === 'mover'), JSON.stringify(seen));
  e.dispose();
});

test('fixed objects do not move when walked into', async () => {
  const e = await makeEngine('/t_fixed');
  e.setScene({ objects: [{ id: 'wall', parts: [boxPart(0.2, 2, 1)], x: 1.3, y: 0, fixed: true }], goal: { x: 4, y: 0 } });
  e.setMode('blind');
  e.step(4000);
  const buf = e.writeFrame(new Float32Array(e.layout.length));
  const o = HEADER + 7 * e.layout.robotGeoms;
  assert.ok(Math.abs(buf[o] - 1.3) < 1e-5 && Math.abs(buf[o + 1]) < 1e-5);
  assert.ok(e.contacts.some((c) => c.entityId === 'wall'));
  assert.ok(e.robotPose().x < 1.3, 'robot should not pass through the wall');
  e.dispose();
});

test('frame buffer layout and header', async () => {
  const e = await makeEngine('/t_frame');
  e.setScene({ objects: [{ id: 'a', parts: [boxPart(0.2, 0.2, 0.2)], x: 2, y: 1 }, { id: 'empty', parts: [], x: 3, y: 3 }] });
  assert.deepEqual(e.layout.objects, ['a', 'empty']);
  assert.equal(e.robotVisuals.length, e.layout.robotGeoms);
  e.setCommand({ vx: 0.3 });
  e.step(500);
  const buf = e.writeFrame(new Float32Array(e.layout.length));
  assert.ok(Math.abs(buf[H_TIME] - 1) < 1e-6);
  assert.equal(buf[H_FALLEN], 0);
  assert.ok(Math.abs(buf[H_PELVIS_X] - e.data.qpos[0]) < 1e-5);
  for (let i = HEADER; i < buf.length; i += 7) assert.ok(Math.abs(Math.hypot(buf[i + 3], buf[i + 4], buf[i + 5], buf[i + 6]) - 1) < 1e-4);
  // the box rests on the floor: centre settles at ~0.1 m
  const o = HEADER + 7 * e.layout.robotGeoms;
  assert.ok(Math.abs(buf[o + 2] - 0.1) < 0.01, `box z ${buf[o + 2]}`);
  // the object without usable parts keeps its slot at its spawn pose
  assert.equal(buf[o + 7], 3);
  e.dispose();
});

test('recompiling with keepRobot keeps the robot walking', async () => {
  const e = await makeEngine('/t_keep');
  e.setCommand({ vx: 0.5 });
  e.step(1000);
  const x0 = e.data.qpos[0];
  e.setScene({ objects: [{ id: 'b', parts: [boxPart(0.3, 0.3, 0.3)], x: -2, y: 0 }] }, { keepRobot: true });
  assert.ok(Math.abs(e.data.qpos[0] - x0) < 1e-9);
  e.step(1000);
  assert.equal(e.status, 'running');
  assert.ok(e.data.qpos[0] > x0 + 0.6);
  e.dispose();
});

test('toMJCF output compiles in MuJoCo with the right mass', async () => {
  const chair = await glbToParts(await sample('chair-parts.glb'));
  const out = toMJCF({ name: 'kitchen chair', parts: chair.parts, mass: chair.mass });
  const { mujoco } = await loadAll();
  mujoco.FS.mkdirTree('/t_export/meshes', 0o777);
  for (const [f, b] of Object.entries(out.files)) mujoco.FS.writeFile(`/t_export/${f}`, b);
  mujoco.FS.writeFile('/t_export/obj.xml', out.xml);
  const m = mujoco.MjModel.from_xml_path('/t_export/obj.xml');
  assert.ok(Math.abs(m.body_mass[1] - chair.mass) < 1e-3, `mass ${m.body_mass[1]} vs ${chair.mass}`);
  assert.equal(Object.keys(out.files).length, 8);
  m.delete();
});

test('toMJCF exports an articulated object: fixed base, the moving part on its hinge with limits', async () => {
  // a frame (two posts and a header, concave) and a door leaf hinged at one post
  const box = (x0, x1, y0, y1, z0, z1) => Float32Array.from([x0, y0, z0, x1, y0, z0, x0, y1, z0, x1, y1, z0, x0, y0, z1, x1, y0, z1, x0, y1, z1, x1, y1, z1]);
  const posts = [...box(-0.5, -0.45, -0.05, 0.05, 0, 2), ...box(0.45, 0.5, -0.05, 0.05, 0, 2), ...box(-0.5, 0.5, -0.05, 0.05, 1.95, 2)];
  const frame = { points: Float32Array.from(posts), meshVolume: 0.05 * 0.1 * 2 * 2 + 1 * 0.1 * 0.05 };
  const leaf = { points: box(-0.44, 0.44, -0.02, 0.02, 0.01, 1.94) };
  const joints = [{ type: 'revolute', child: 1, pivot: [-0.44, 0, 0], axis: [0, 1, 0], lower: 0, upper: 1.6 }];
  const out = toMJCF({ name: 'test door', parts: [frame, leaf], mass: 20, joints });
  const { mujoco } = await loadAll();
  mujoco.FS.mkdirTree('/t_door/meshes', 0o777);
  for (const [f, b] of Object.entries(out.files)) mujoco.FS.writeFile(`/t_door/${f}`, b);
  mujoco.FS.writeFile('/t_door/object.xml', out.xml);
  mujoco.FS.writeFile('/t_door/scene.xml', out.scene);
  const m = mujoco.MjModel.from_xml_path('/t_door/scene.xml');
  assert.equal(m.njnt, 1, 'one hinge, no free joint');
  assert.equal(m.jnt_type[0], 3, 'hinge');
  assert.ok(Math.abs(m.jnt_range[1] - 1.6) < 1e-6);
  assert.ok(out.xml.includes('_part2'), 'the concave frame became two posts plus the leaf');
  m.delete();
});
