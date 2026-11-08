// Live planner, in the arena's call order: setScene -> setMode('planner') -> getPlan, then
// reset -> setMode -> play. Uses the library park bench (Lux3D part split, Y-up, as served by
// /api/objects/<id>/parts.json) across the path, like the "Bench in the way (planner)" course.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEngine, WEB } from './helpers.mjs';

const doc = JSON.parse(await readFile(path.join(WEB, 'tests/sim/fixtures/park-bench-parts.json'), 'utf8'));
const parts = doc.parts.map((p) => {
  const s = p.points, o = new Float32Array(s.length);
  for (let i = 0; i < s.length; i += 3) { o[i] = s[i]; o[i + 1] = -s[i + 2]; o[i + 2] = s[i + 1]; }
  return { points: o };
});
const scene = { objects: [{ id: 'o0', name: 'park bench', parts, x: 1.9, y: 0.05, yaw: 1.45, mass: doc.volume * 400 }], movers: [], start: { x: 0, y: 0, yaw: 0 }, goal: { x: 4.5, y: 0 } };

/** Largest |y| of a polyline where it passes the bench (x within 0.5 m of 1.9). */
function clearance(plan) {
  let m = 0;
  for (let i = 0; i + 3 < plan.length; i += 2) {
    for (let k = 0; k <= 10; k++) {
      const x = plan[i] + ((plan[i + 2] - plan[i]) * k) / 10, y = plan[i + 1] + ((plan[i + 3] - plan[i + 1]) * k) / 10;
      if (Math.abs(x - 1.9) < 0.5) m = Math.max(m, Math.abs(y));
    }
  }
  return m;
}

test('getPlan has a path right after setMode(planner), after setScene in planner mode, and after reset', async () => {
  const e = await makeEngine('/t_plan_live');
  e.setScene(scene);
  assert.equal(e.plan, null, 'no plan in blind/manual mode');
  e.setMode('planner');
  assert.ok(e.plan && e.plan.length >= 6, 'plan right after setMode');
  assert.ok(clearance(e.plan) > 0.9, `plan goes around the bench (clearance ${clearance(e.plan)})`);
  e.setScene(scene);
  assert.ok(e.plan, 'plan right after setScene while in planner mode');
  e.reset();
  assert.ok(e.plan, 'plan right after reset');
  e.setGoal(4.5, 1.5);
  assert.ok(e.plan && Math.abs(e.plan[e.plan.length - 1] - 1.5) < 1e-9, 'setGoal replans to the new goal');
  e.dispose();
});

test('arena call order: the live robot follows the plan around the bench to the goal', async () => {
  const e = await makeEngine('/t_plan_live2');
  e.setScene(scene);
  e.setMode('planner');
  e.reset();
  e.setMode('planner');
  let maxY = 0;
  for (let k = 0; k < 50 && e.status === 'running'; k++) {
    e.step(250);
    const p = e.robotPose();
    if (Math.abs(p.x - 1.9) < 0.5) maxY = Math.max(maxY, Math.abs(p.y));
  }
  assert.equal(e.status, 'goal', `status ${e.status} at ${JSON.stringify(e.robotPose())}`);
  assert.ok(maxY > 0.9, `walked around the bench (|y| ${maxY})`);
  assert.equal(e.contacts.filter((c) => c.entityId === 'o0').length, 0, 'never touched the bench');
  e.dispose();
});

test('the same course in runTrials(planner) agrees with the live run', async () => {
  const e = await makeEngine('/t_plan_live3');
  const s = e.runTrials({ scene, n: 4, seed: 1001, mode: 'planner', maxSeconds: 25 });
  assert.equal(s.trials.filter((t) => t.result === 'goal').length, 4);
  e.dispose();
});
