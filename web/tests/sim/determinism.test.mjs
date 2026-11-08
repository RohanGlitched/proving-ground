// (d) same seed -> identical trial results; different seed -> different starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, boxPart } from './helpers.mjs';

const scene = { objects: [{ id: 'box', name: 'box', parts: [boxPart(0.4, 0.4, 0.3)], x: 1.6, y: 0.1 }], goal: { x: 3.5, y: 0 } };
const opts = { scene, n: 4, seed: 42, mode: 'blind', maxSeconds: 10, jitter: { objectPos: 0.05, objectYaw: 0.2 }, pushes: { count: 1, force: 100 } };
const strip = (s) => s.trials.map((t) => ({ r: t.result, t: t.time, f: t.fallPoint, c: t.firstContactObject, p: Array.from(t.path), s: t.start, pu: t.pushes }));

test('trials are deterministic per seed (same engine and a fresh engine)', async () => {
  const a = await makeEngine('/t_det_a');
  const r1 = strip(a.runTrials(opts));
  const r2 = strip(a.runTrials(opts));
  assert.deepEqual(r1, r2);
  const b = await makeEngine('/t_det_b');
  assert.deepEqual(strip(b.runTrials(opts)), r1);
  const r3 = strip(b.runTrials({ ...opts, seed: 43 }));
  assert.notDeepEqual(r3.map((t) => t.s), r1.map((t) => t.s));
  a.dispose();
  b.dispose();
});
