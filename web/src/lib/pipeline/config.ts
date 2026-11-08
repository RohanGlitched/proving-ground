import { randomBytes } from "node:crypto";
import type { Version } from "./aholo";

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

/** Env-driven knobs (read at call time so tests and scripts can change them). */
export const config = {
  get perIpHour() {
    return num(process.env.LIMIT_PER_IP_HOUR, 3);
  },
  get perDay() {
    return num(process.env.LIMIT_PER_DAY, 40);
  },
  /** New public jobs are refused when the Lux3D balance is below this. */
  get minCredits() {
    return num(process.env.LIMIT_MIN_CREDITS, 300);
  },
  get paused() {
    return process.env.PIPELINE_PAUSED === "1";
  },
  get version(): Version {
    return process.env.LUX_VERSION === "G1" ? "G1" : "G1-Turbo";
  },
  get faceCount() {
    return Math.min(300_000, Math.max(10_000, num(process.env.LUX_FACES, 20_000)));
  },
  /** Objects whose largest dimension is below this skip part-split (metres). */
  get splitMinDim() {
    return num(process.env.SPLIT_MIN_DIM, 0.12);
  },
};

/** Measured stage durations (s) for ETAs; Nov 9 2026. */
export const TYPICAL_SECONDS: Record<string, number> = {
  "upload-input": 3,
  generate: 80,
  "fetch-result": 6,
  "upload-for-split": 6,
  "part-split": 80,
  "upload-for-rig": 6,
  rig: 90,
  "upload-for-retarget": 6,
  retarget: 60,
  "upload-for-articulation": 6,
  articulate: 120,
  process: 4,
  "upload-for-export": 6,
  export: 60,
  publish: 1,
};

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A 10-character lowercase id (36^10 ≈ 3.7e15), URL-safe and storage-key safe. */
export function newId(len = 10): string {
  let out = "";
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < 252 && out.length < len) out += ALPHABET[b % 36];
    }
  }
  return out;
}

export const isId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-z]{6,16}$/.test(s);
