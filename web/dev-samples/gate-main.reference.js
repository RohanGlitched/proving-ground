// Gate page: G1 walking policy in MuJoCo WASM. Checks load, parity with Python, speed, pushes.
import loadMujoco from '@mujoco/mujoco';

const out = document.getElementById('out');
const log = (s) => { out.textContent += s + '\n'; console.log('[gate]', s); };

const FILES = ['scene.xml', 'g1_12dof.xml'];
const MESHES = ['head_link', 'left_ankle_pitch_link', 'left_ankle_roll_link', 'left_elbow_link', 'left_hip_pitch_link', 'left_hip_roll_link', 'left_hip_yaw_link', 'left_knee_link', 'left_shoulder_pitch_link', 'left_shoulder_roll_link', 'left_shoulder_yaw_link', 'left_wrist_roll_rubber_hand', 'logo_link', 'pelvis', 'pelvis_contour_link', 'right_ankle_pitch_link', 'right_ankle_roll_link', 'right_elbow_link', 'right_hip_pitch_link', 'right_hip_roll_link', 'right_hip_yaw_link', 'right_knee_link', 'right_shoulder_pitch_link', 'right_shoulder_roll_link', 'right_shoulder_yaw_link', 'right_wrist_roll_rubber_hand', 'torso_link_23dof_rev_1_0'];
const NOISE = [0.001257302210933933, -0.0013210486329130189, 0.006404226504432821, 0.001049001171530397, -0.005356693731611109, 0.0036159505490948474, 0.013040000451301373, 0.009470809631292421, -0.007037352358069926, -0.012654214710460526, -0.006232744625373522, 0.000413259793472436];
const KP = [100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40], KD = [2, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2];
const DEF = [-0.1, 0, 0, 0.3, -0.2, 0, -0.1, 0, 0, 0.3, -0.2, 0];

const sig = (x) => 1 / (1 + Math.exp(-x));
function matvec(W, rows, cols, x, out, add) {
  for (let r = 0; r < rows; r++) { let s = add ? add[r] : 0; const o = r * cols; for (let c = 0; c < cols; c++) s += W[o + c] * x[c]; out[r] = s; }
  return out;
}
function makePolicy(w) {
  const h = new Float64Array(64), c = new Float64Array(64), g = new Float64Array(256), g2 = new Float64Array(256), a1 = new Float64Array(32), a = new Float64Array(12);
  return (x) => {
    matvec(w.Wih, 256, 47, x, g, w.bih); matvec(w.Whh, 256, 64, h, g2, w.bhh);
    for (let k = 0; k < 64; k++) {
      const i = sig(g[k] + g2[k]), f = sig(g[64 + k] + g2[64 + k]), gg = Math.tanh(g[128 + k] + g2[128 + k]), o = sig(g[192 + k] + g2[192 + k]);
      c[k] = f * c[k] + i * gg; h[k] = o * Math.tanh(c[k]);
    }
    matvec(w.W1, 32, 64, h, a1, w.b1); for (let k = 0; k < 32; k++) a1[k] = a1[k] > 0 ? a1[k] : Math.exp(a1[k]) - 1;
    return matvec(w.W2, 12, 32, a1, a, w.b2);
  };
}
const grav = (q) => { const [w, x, y, z] = q; return [2 * (-z * x + w * y), -2 * (z * y + w * x), 1 - 2 * (w * w + z * z)]; };

async function main() {
  const t0 = performance.now();
  const mujoco = await loadMujoco();
  const vfs = new mujoco.MjVFS();
  const get = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const names = [...FILES, ...MESHES.flatMap((m) => [`meshes/${m}_vis.stl`, `meshes/${m}_hull.stl`])];
  const bufs = await Promise.all(names.map((n) => get(`/g1lite/${n}`)));
  log(`fetched ${names.length} files in ${(performance.now() - t0).toFixed(0)} ms`);
  const tw = performance.now();
  mujoco.FS.mkdirTree('/g1/meshes', 0o777);
  names.forEach((n, i) => mujoco.FS.writeFile(`/g1/${n}`, bufs[i]));
  log(`wrote files in ${(performance.now() - tw).toFixed(0)} ms`);
  const W = await (await fetch('/g1_policy.json')).json();
  const tc = performance.now();
  const model = mujoco.MjModel.from_xml_path('/g1/scene.xml');
  log(`compiled in ${(performance.now() - tc).toFixed(0)} ms; total load ${(performance.now() - t0).toFixed(0)} ms (nq=${model.nq} nu=${model.nu})`);
  const pelvis = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, 'pelvis');

  function run(seconds, push) {
    const data = new mujoco.MjData(model); model.opt.timestep = 0.002;
    const qpos = data.qpos, qvel = data.qvel, ctrl = data.ctrl, xfrc = data.xfrc_applied;
    for (let j = 0; j < 12; j++) qpos[7 + j] = DEF[j] + NOISE[j];
    const pol = makePolicy(W), obs = new Float64Array(47); let act = new Float64Array(12); const tgt = DEF.slice();
    let fell = null; const steps = Math.round(seconds / 0.002);
    for (let k = 0; k < steps; k++) {
      const t = k * 0.002;
      for (let i = 0; i < 6; i++) xfrc[pelvis * 6 + i] = 0;
      if (push && t >= push.t && t < push.t + 0.2) { xfrc[pelvis * 6] = push.F * Math.cos(push.a); xfrc[pelvis * 6 + 1] = push.F * Math.sin(push.a); }
      for (let j = 0; j < 12; j++) ctrl[j] = (tgt[j] - qpos[7 + j]) * KP[j] - qvel[6 + j] * KD[j];
      mujoco.mj_step(model, data);
      if ((k + 1) % 10 === 0) {
        const ph = (((k + 1) * 0.002) % 0.8) / 0.8, gv = grav([qpos[3], qpos[4], qpos[5], qpos[6]]);
        obs[0] = qvel[3] * 0.25; obs[1] = qvel[4] * 0.25; obs[2] = qvel[5] * 0.25; obs[3] = gv[0]; obs[4] = gv[1]; obs[5] = gv[2];
        obs[6] = 0.5 * 2; obs[7] = 0; obs[8] = 0;
        for (let j = 0; j < 12; j++) { obs[9 + j] = qpos[7 + j] - DEF[j]; obs[21 + j] = qvel[6 + j] * 0.05; obs[33 + j] = act[j]; }
        obs[45] = Math.sin(2 * Math.PI * ph); obs[46] = Math.cos(2 * Math.PI * ph);
        act = Float64Array.from(pol(obs)); for (let j = 0; j < 12; j++) tgt[j] = act[j] * 0.25 + DEF[j];
      }
      if (fell === null && (qpos[2] < 0.45 || grav([qpos[3], qpos[4], qpos[5], qpos[6]])[2] > -0.5)) fell = t;
    }
    const r = { x: qpos[0], y: qpos[1], z: qpos[2], fell };
    data.delete(); return r;
  }

  const ref = { x: 0.79987, y: -0.02247, z: 0.76789 };
  let t = performance.now(); const p = run(2.0);
  const dt = performance.now() - t;
  log(`parity t=2s: js x=${p.x.toFixed(5)} y=${p.y.toFixed(5)} z=${p.z.toFixed(5)} | python x=${ref.x} y=${ref.y} z=${ref.z} | max diff ${Math.max(Math.abs(p.x - ref.x), Math.abs(p.y - ref.y), Math.abs(p.z - ref.z)).toExponential(2)}`);
  log(`speed: 2 s sim in ${dt.toFixed(0)} ms -> ${(2000 / dt).toFixed(1)}x real time`);
  t = performance.now(); let up = 0;
  for (let s = 0; s < 10; s++) { const r = run(6.2, { t: 3.0, F: 150, a: s * 0.628 }); up += r.fell === null; }
  log(`push 150 N x 0.2 s, 10 directions: upright ${up}/10 in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  t = performance.now(); up = 0;
  for (let s = 0; s < 10; s++) { const r = run(6.2, { t: 3.0, F: 300, a: s * 0.628 }); up += r.fell === null; }
  log(`push 300 N x 0.2 s, 10 directions: upright ${up}/10 in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  log('DONE');
}
main().catch((e) => log('ERROR ' + (e.stack || e)));
