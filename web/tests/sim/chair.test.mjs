// (b) chair 1.5 m ahead: blind walks into it; planner walks around it. (e) chair size and mass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, sample } from './helpers.mjs';
import { glbToParts } from '../../src/sim/assets.ts';

const chair = await glbToParts(await sample('chair-parts.glb'));
const scene = { objects: [{ id: 'chair', name: 'chair', parts: chair.parts, x: 1.5, y: 0, yaw: 0 }], start: { x: 0, y: 0, yaw: 0 }, goal: { x: 4, y: 0 } };

test('chair: size and mass are sane after Y-up -> Z-up', () => {
  const [sx, sy, sz] = chair.bboxMeters.size;
  assert.ok(Math.abs(sx - 0.48) < 0.02 && Math.abs(sy - 0.45) < 0.02 && Math.abs(sz - 0.85) < 0.02, `bbox ${sx} ${sy} ${sz}`);
  assert.ok(chair.mass >= 4 && chair.mass <= 8, `mass ${chair.mass}`);
  assert.equal(chair.parts.length, 8);
  assert.equal(chair.split, 'nodes');
  for (const p of chair.parts) assert.ok(p.points.length / 3 <= 96);
});

test('blind mode walks into the chair and the contact names it', async () => {
  const e = await makeEngine('/t_blind');
  e.setScene(scene);
  e.setMode('blind');
  const seen = [];
  for (let k = 0; k < 40 && e.status === 'running'; k++) seen.push(...e.step(250).newContacts);
  assert.ok(seen.length > 0, 'expected a contact');
  assert.equal(seen[0].entityId, 'chair');
  assert.equal(seen[0].kind, 'object');
  assert.ok(seen[0].t > 1 && seen[0].t < 6, `first contact at ${seen[0].t}`);
  e.dispose();
});

test('planner mode reaches a goal 4 m ahead around the chair in >= 8/10 seeded trials', async () => {
  const e = await makeEngine('/t_plan');
  const s = e.runTrials({ scene, n: 10, seed: 1, mode: 'planner', maxSeconds: 20 });
  const goals = s.trials.filter((t) => t.result === 'goal').length;
  console.log(`planner: ${goals}/10 goals, mean ${s.meanTimeToGoal?.toFixed(2)} s, ${s.simSeconds.toFixed(0)} s sim in ${s.wallMs.toFixed(0)} ms`);
  assert.ok(goals >= 8, `planner goals ${goals}/10`);
  const touched = s.trials.filter((t) => t.firstContactObject === 'chair').length;
  assert.ok(touched <= 2, `planner touched chair in ${touched} trials`);
  // walked around: the path leaves the straight line next to the chair
  const t0 = s.trials[0];
  let maxY = 0;
  for (let i = 0; i < t0.path.length; i += 2) if (Math.abs(t0.path[i] - 1.5) < 0.4) maxY = Math.max(maxY, Math.abs(t0.path[i + 1]));
  assert.ok(maxY > 0.4, `lateral clearance ${maxY}`);
  e.dispose();
});
