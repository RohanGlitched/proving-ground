// Unitree G1 walking policy (unitree_rl_gym deploy/pre_train/g1/motion.pt, BSD-3-Clause), in plain JS.
// LSTM 47 -> 64, Linear 64 -> 32 + ELU, Linear 32 -> 12. Constants match Unitree's deploy config
// and the Kiroween gate (hackathons/39-kiroween/gate/golem/run_g1.py). Do not change them.

export interface PolicyWeights {
  Wih: number[]; Whh: number[]; bih: number[]; bhh: number[];
  W1: number[]; b1: number[]; W2: number[]; b2: number[];
}

export const DT = 0.002; // physics step (500 Hz)
export const DECIMATION = 10; // policy at 50 Hz
export const PHASE_PERIOD = 0.8; // s
export const KP = [100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40];
export const KD = [2, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2];
export const DEFAULT_ANGLES = [-0.1, 0, 0, 0.3, -0.2, 0, -0.1, 0, 0, 0.3, -0.2, 0];
export const ACTION_SCALE = 0.25;
export const CMD_SCALE = [2.0, 2.0, 0.25];
export const ANG_VEL_SCALE = 0.25;
export const DOF_POS_SCALE = 1.0;
export const DOF_VEL_SCALE = 0.05;
/** numpy default_rng(0).normal(0, 0.01, 12): the joint noise the gate and Python reference use. */
export const GATE_NOISE = [0.001257302210933933, -0.0013210486329130189, 0.006404226504432821, 0.001049001171530397, -0.005356693731611109, 0.0036159505490948474, 0.013040000451301373, 0.009470809631292421, -0.007037352358069926, -0.012654214710460526, -0.006232744625373522, 0.000413259793472436];

const sig = (x: number) => 1 / (1 + Math.exp(-x));

function matvec(W: Float64Array, rows: number, cols: number, x: ArrayLike<number>, out: Float64Array, add: Float64Array | null) {
  for (let r = 0; r < rows; r++) {
    let s = add ? add[r] : 0;
    const o = r * cols;
    for (let c = 0; c < cols; c++) s += W[o + c] * x[c];
    out[r] = s;
  }
  return out;
}

/** Packed weights, shared across policy instances. */
export interface PackedWeights {
  Wih: Float64Array; Whh: Float64Array; bih: Float64Array; bhh: Float64Array;
  W1: Float64Array; b1: Float64Array; W2: Float64Array; b2: Float64Array;
}

export function packWeights(w: PolicyWeights): PackedWeights {
  const f = (a: number[]) => Float64Array.from(a);
  return { Wih: f(w.Wih), Whh: f(w.Whh), bih: f(w.bih), bhh: f(w.bhh), W1: f(w.W1), b1: f(w.b1), W2: f(w.W2), b2: f(w.b2) };
}

/** Stateful LSTM policy. reset() clears the recurrent state. */
export class Policy {
  readonly h = new Float64Array(64);
  readonly c = new Float64Array(64);
  private g = new Float64Array(256);
  private g2 = new Float64Array(256);
  private a1 = new Float64Array(32);
  readonly out = new Float64Array(12);
  constructor(private w: PackedWeights) {}
  reset() { this.h.fill(0); this.c.fill(0); }
  /** Runs one step. Returns a view that is overwritten on the next call. */
  run(x: Float64Array): Float64Array {
    const { w, h, c, g, g2, a1 } = this;
    matvec(w.Wih, 256, 47, x, g, w.bih);
    matvec(w.Whh, 256, 64, h, g2, w.bhh);
    for (let k = 0; k < 64; k++) {
      const i = sig(g[k] + g2[k]), f = sig(g[64 + k] + g2[64 + k]), gg = Math.tanh(g[128 + k] + g2[128 + k]), o = sig(g[192 + k] + g2[192 + k]);
      c[k] = f * c[k] + i * gg;
      h[k] = o * Math.tanh(c[k]);
    }
    matvec(w.W1, 32, 64, h, a1, w.b1);
    for (let k = 0; k < 32; k++) a1[k] = a1[k] > 0 ? a1[k] : Math.exp(a1[k]) - 1;
    return matvec(w.W2, 12, 32, a1, this.out, w.b2);
  }
}

/** Projected gravity in the pelvis frame from a MuJoCo quaternion (w x y z). z is -1 when upright. */
export function projectedGravity(qw: number, qx: number, qy: number, qz: number, out: number[] | Float64Array) {
  out[0] = 2 * (-qz * qx + qw * qy);
  out[1] = -2 * (qz * qy + qw * qx);
  out[2] = 1 - 2 * (qw * qw + qz * qz);
  return out;
}
