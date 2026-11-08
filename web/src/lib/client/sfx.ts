// Tiny synthesized sound effects (no audio files): a body hitting the floor, a shove, a goal chime.
// The AudioContext is created on the first user gesture (pressing Walk) as browsers require.
let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem("pg-muted") === "1";
} catch {}

export function unlockAudio() {
  if (typeof window === "undefined") return;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {}
}
export const isMuted = () => muted;
export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem("pg-muted", v ? "1" : "0");
  } catch {}
}

function noise(c: AudioContext, seconds: number) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}

/** A heavy thud: a falling sine plus a short filtered noise burst. */
export function thud(strength = 1) {
  if (muted || !ctx) return;
  const c = ctx, t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55 * strength, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.55);
  const n = noise(c, 0.25), f = c.createBiquadFilter(), ng = c.createGain();
  f.type = "lowpass";
  f.frequency.value = 900;
  ng.gain.value = 0.35 * strength;
  n.connect(f).connect(ng).connect(c.destination);
  n.start(t);
}

/** A short whoosh for a shove. */
export function whoosh() {
  if (muted || !ctx) return;
  const c = ctx, t = c.currentTime;
  const n = noise(c, 0.3), f = c.createBiquadFilter(), g = c.createGain();
  f.type = "bandpass";
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(2200, t + 0.22);
  g.gain.value = 0.3;
  n.connect(f).connect(g).connect(c.destination);
  n.start(t);
}

/** Two rising notes when the robot reaches the flag. */
export function chime() {
  if (muted || !ctx) return;
  const c = ctx;
  [660, 990].forEach((hz, i) => {
    const t = c.currentTime + i * 0.11;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "triangle";
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.4);
  });
}
