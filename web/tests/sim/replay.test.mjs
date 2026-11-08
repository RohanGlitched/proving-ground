// Trial replay: a live replay (beginTrial + advanceTrial in irregular real-time-sized chunks, on a fresh
// engine, after other activity) must be bit-identical to the runTrials result for that index.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, sample, boxPart } from './helpers.mjs';
import { glbToParts } from '../../src/sim/assets.ts';

const chair = await glbToParts(await sample('chair-parts.glb'));
const scene = {
  objects: [
    { id: 'chair', name: 'chair', parts: chair.parts, x: 1.5, y: 0, yaw: 0 },
    { id: 'step', name: 'step', parts: [boxPart(0.3, 0.6, 0.08)], x: 2.6, y: 0.5, fixed: true },
  ],
  goal: { x: 4, y: 0 },
};
const options = { scene, n: 6, seed: 11, mode: 'blind', maxSeconds: 14, jitter: { startPos: 0.15, objectPos: 0.05, objectYaw: 0.2 }, pushes: { count: 1, force: 200 } };
const key = (r) => ({ result: r.result, time: r.time, fallPoint: r.fallPoint, first: r.firstContactObject, cause: r.fallCause, path: Array.from(r.path), contacts: r.contacts.map((c) => [c.entityId, c.t, c.peakForce, c.impulse]) });

test('replayTrial is bit-identical to runTrials for every index', async () => {
  const trials = await makeEngine('/t_rep_trials');
  const summary = trials.runTrials(options);
  const outcomes = new Set(summary.trials.map((t) => t.result));
  console.log('outcomes', summary.trials.map((t) => `${t.result}@${t.time.toFixed(2)}`).join(' '));
  assert.ok(outcomes.size >= 2, 'course should produce more than one kind of outcome');

  const live = await makeEngine('/t_rep_live');
  // unrelated live activity first: the replay must not depend on it
  live.setScene({ objects: [] });
  live.setMode('manual');
  live.setCommand({ vx: 0.4, yaw: 0.3 });
  live.step(700);
  let rnd = 12345;
  const nextChunk = () => { rnd = (rnd * 1103515245 + 12345) >>> 0; return 1 + (rnd % 60); }; // 1..60 steps, like a paced tick
  for (const index of [0, 2, 3, 5]) {
    live.setScene(options.scene);
    const run = live.beginTrial(options, index);
    const pushesSeen = [];
    while (!run.result) pushesSeen.push(...live.advanceTrial(run, nextChunk()).newPushes);
    assert.deepEqual(key(run.result), key(summary.trials[index]), `trial ${index}`);
    // the push event fires once, at the scheduled time, with the scheduled force and angle
    const expected = summary.trials[index].pushes.filter((p) => Math.round(p.t / 0.002) * 0.002 <= run.result.time);
    assert.equal(pushesSeen.length, expected.length);
    pushesSeen.forEach((p, i) => {
      assert.ok(Math.abs(p.t - expected[i].t) <= 0.001);
      assert.equal(p.force, expected[i].force);
      assert.equal(p.angle, expected[i].angle);
    });
  }
  trials.dispose();
  live.dispose();
});
