import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localStore } from "../../src/lib/storage.ts";

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const sample = (name) => path.join(WEB, "dev-samples", name);
export const hasSamples = () => existsSync(sample("chair-parts.glb")) && existsSync(sample("chair.glb")) && existsSync(sample("sneaker.glb"));
export const readSample = (name) => readFileSync(sample(name));

/** A fresh local store in a temp dir; call cleanup() when done. */
export function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "pg-store-"));
  return { store: localStore(dir), dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A fake clock that moves forward `step` ms on every read. */
export function fakeClock(start = 1_800_000_000_000, step = 4000) {
  let t = start;
  return { now: () => (t += step), peek: () => t, jump: (ms) => (t += ms) };
}
