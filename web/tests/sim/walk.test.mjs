// (a) Policy parity: the gate's 6 s straight walk at 0.5 m/s with the Python reference noise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine } from './helpers.mjs';

test('G1 walks 6 s at 0.5 m/s like the Python/gate reference', async () => {
  const e = await makeEngine('/t_walk');
  e.reset({ noise: 'gate' });
  e.setMode('manual');
  e.setCommand({ vx: 0.5, vy: 0, yaw: 0 });
  e.step(1000);
  const q = e.data.qpos;
  // Python (MuJoCo 3.17) after 2 s: 0.79987, -0.02247, 0.76789 (gate parity 2.5e-6 m)
  assert.ok(Math.abs(q[0] - 0.79987) < 1e-4 && Math.abs(q[1] + 0.02247) < 1e-4 && Math.abs(q[2] - 0.76789) < 1e-4, `2 s pose ${q[0]} ${q[1]} ${q[2]}`);
  e.step(2000);
  const x = e.data.qpos[0];
  assert.ok(Math.abs(x - 2.6983) / 2.6983 < 0.02, `6 s distance ${x} vs 2.6983`);
  assert.equal(e.status, 'running');
  e.dispose();
});

test('robot stands still on a zero command and stays up for 5 s', async () => {
  const e = await makeEngine('/t_stand');
  e.setCommand({ vx: 0, vy: 0, yaw: 0 });
  e.step(2500);
  assert.equal(e.status, 'running');
  assert.ok(Math.hypot(e.data.qpos[0], e.data.qpos[1]) < 0.3);
  e.dispose();
});
