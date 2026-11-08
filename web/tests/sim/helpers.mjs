// Node helpers for sim tests: load MuJoCo WASM and the G1 assets from public/g1.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import loadMujoco from '@mujoco/mujoco';
import { Engine } from '../../src/sim/engine.ts';
import { loadRobotAssets } from '../../src/sim/robot.ts';

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let cached = null;

export async function loadAll() {
  if (cached) return cached;
  const t0 = performance.now();
  const mujoco = await loadMujoco();
  const assets = await loadRobotAssets(async (p) => new Uint8Array(await readFile(path.join(WEB, 'public/g1', p))));
  cached = { mujoco, assets, loadMs: performance.now() - t0 };
  return cached;
}

export async function makeEngine(dir) {
  const { mujoco, assets } = await loadAll();
  return Engine.create({ mujoco, assets, dir });
}

export const sample = (name) => readFile(path.join(WEB, 'dev-samples', name));
