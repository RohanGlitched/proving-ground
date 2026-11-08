// (c) compile time with 20 objects x 6 parts stays under 500 ms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, sample } from './helpers.mjs';
import { glbToParts } from '../../src/sim/assets.ts';

test('20 objects x 6 parts compile in < 500 ms', async () => {
  const chair = await glbToParts(await sample('chair-parts.glb'));
  const e = await makeEngine('/t_compile');
  const make = () => Array.from({ length: 20 }, (_, i) => ({
    id: `o${i}`,
    // fresh part objects so the per-part hull cache cannot help
    parts: chair.parts.slice(0, 6).map((p) => ({ points: p.points.slice(), volume: p.volume })),
    x: 1 + (i % 5) * 0.9, y: -2 + Math.floor(i / 5) * 1.1, yaw: i * 0.3,
  }));
  e.setScene({ objects: make() }); // warm up
  // best of 3: the other test files run in parallel processes and can steal the CPU
  let ms = Infinity, r = null;
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    r = e.setScene({ objects: make() });
    ms = Math.min(ms, performance.now() - t0);
  }
  console.log(`compile ${r.compileMs.toFixed(0)} ms (setScene ${ms.toFixed(0)} ms), ${e.model.ngeom} geoms`);
  assert.ok(ms < 500, `setScene took ${ms} ms`);
  assert.equal(e.layout.objects.length, 20);
  assert.equal(e.layout.length, 20 + 7 * (e.layout.robotGeoms + 20));
  e.step(500);
  assert.equal(e.status, 'running');
  e.dispose();
});
