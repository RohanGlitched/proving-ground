// Command-range sweep: which (vx, vy, yaw) commands the G1 policy tracks without falling.
// Run: node --import tsx scripts/sim-sweep.mjs
import { makeEngine } from '../tests/sim/helpers.mjs';

const e = await makeEngine('/sweep');
const rows = [];
const run = (vx, vy, yaw, seconds = 10) => {
  e.reset();
  e.setMode('manual');
  e.setCommand({ vx, vy, yaw });
  e.step(Math.round(2 / 0.002));
  const p0 = e.robotPose(), t0 = e.time;
  let yawAcc = 0, prev = p0, fwdAcc = 0, latAcc = 0;
  for (let k = 0; k < (seconds - 2) / 0.4 && e.status === 'running'; k++) {
    e.step(200);
    const p = e.robotPose();
    const dyaw = Math.atan2(Math.sin(p.yaw - prev.yaw), Math.cos(p.yaw - prev.yaw));
    const h = prev.yaw + dyaw / 2, dx = p.x - prev.x, dy = p.y - prev.y;
    fwdAcc += dx * Math.cos(h) + dy * Math.sin(h);
    latAcc += -dx * Math.sin(h) + dy * Math.cos(h);
    yawAcc += dyaw;
    prev = p;
  }
  const dt = e.time - t0;
  const fwd = fwdAcc / dt, lat = latAcc / dt;
  rows.push({ vx, vy, yaw, fell: e.status === 'fell' ? +e.fellAt.toFixed(2) : '', vxMeas: +fwd.toFixed(3), vyMeas: +lat.toFixed(3), yawMeas: +(yawAcc / dt).toFixed(3) });
};
for (const vx of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2]) run(vx, 0, 0);
for (const vx of [-0.3, -0.5]) run(vx, 0, 0);
for (const yaw of [0.4, 0.8, 1.0, 1.5]) { run(0, 0, yaw); run(0.5, 0, yaw); run(0.5, 0, -yaw); }
for (const vy of [0.2, 0.4, -0.4]) run(0, vy, 0);
console.table(rows);
