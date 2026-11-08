// Seeded PRNG (mulberry32) with uniform and normal draws. Same seed, same sequence, every platform.
export class Rng {
  private s: number;
  private spare: number | null = null;
  constructor(seed: number) { this.s = (seed >>> 0) ^ 0x9e3779b9; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number) { return a + (b - a) * this.next(); }
  normal(mu = 0, sigma = 1) {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return mu + sigma * v; }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mu + sigma * r * Math.cos(2 * Math.PI * v);
  }
}

/** Mixes a base seed and an index into a new 32-bit seed. */
export function mixSeed(seed: number, i: number) {
  let h = (seed >>> 0) ^ Math.imul(i + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
