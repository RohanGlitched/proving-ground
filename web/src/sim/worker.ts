/// <reference lib="webworker" />
// Sim Web Worker: owns MuJoCo and the engine. Live role steps in real time (paced to the wall clock)
// and publishes frames at ~60 Hz; trials role runs trials as fast as it can.
import loadMujoco from '@mujoco/mujoco';
import { glbToParts } from './assets';
import { Engine } from './engine';
import { DT } from './policy';
import { MAX_POSES, type InitResult, type Request, type SceneResult, type WorkerEvent } from './protocol';
import { loadRobotAssets } from './robot';
import type { TrialResult, TrialRun } from './types';

declare const self: DedicatedWorkerGlobalScope;

let engine: Engine | null = null;
let role: 'live' | 'trials' = 'live';
let playing = false;
let rate = 1;
let lastWall = 0;
let residual = 0;
let lastPublish = 0;
let lastStatus = '';
let shared: SharedArrayBuffer | null = null;
let sharedF: Float32Array | null = null;
let sharedCtl: Int32Array | null = null;
let slot = 0;
const SLOT = 20 + 7 * MAX_POSES;
let perfSteps = 0, perfWall = 0, perfT0 = 0;

/** Live replay of one trial: same code path as runTrials (Engine.beginTrial/advanceTrial). */
interface Replay {
  run: TrialRun;
  tailLeft: number; // physics steps to keep showing after the end result
  resolve: (r: TrialResult | null) => void;
}
let replay: Replay | null = null;

function endReplay(result: TrialResult | null) {
  if (!replay) return;
  const r = replay;
  replay = null;
  post({ type: 'replay', phase: 'end', index: r.run.index, result });
  r.resolve(result);
}

/** Runs n physics steps of whatever the live view is doing (free play or a replay). */
function advance(n: number) {
  const e = engine!;
  if (!replay) { emitEvents(e.step(n)); return; }
  if (!replay.run.result) {
    emitEvents(e.advanceTrial(replay.run, n));
    const res = replay.run.result as TrialResult | null;
    if (res) {
      // keep the crumple / arrival on screen for a moment; a timeout ends at once
      if (res.result === 'timeout') replay.tailLeft = 0;
      if (replay.tailLeft <= 0) { playing = false; publish(); endReplay(res); }
    }
    return;
  }
  const k = Math.min(n, replay.tailLeft);
  if (k > 0) emitEvents(e.step(k));
  replay.tailLeft -= k;
  if (replay.tailLeft <= 0) { const r = replay.run.result; playing = false; publish(); endReplay(r); }
}

const post = (m: WorkerEvent, transfer?: Transferable[]) => self.postMessage(m, transfer ?? []);

function publish() {
  if (!engine) return;
  const n = engine.layout.length;
  if (sharedF && sharedCtl) {
    slot = (Atomics.load(sharedCtl, 0) + 1) % 3;
    engine.writeFrame(sharedF.subarray(slot * SLOT, slot * SLOT + n));
    Atomics.store(sharedCtl, 0, slot);
    Atomics.add(sharedCtl, 1, 1);
  } else {
    const buf = engine.writeFrame(new Float32Array(n));
    post({ type: 'frame', buf }, [buf.buffer]);
  }
}

function emitEvents(info: ReturnType<Engine['step']>) {
  for (const c of info.newContacts) post({ type: 'contact', event: c });
  for (const p of info.newPushes) post({ type: 'push', event: p });
  if (info.status !== lastStatus) {
    lastStatus = info.status;
    post({ type: 'status', status: info.status, t: info.status === 'fell' ? info.fellAt ?? info.t : info.status === 'goal' ? info.goalAt ?? info.t : info.t });
  }
}

function tick() {
  if (!engine || !playing) return;
  const now = performance.now();
  const elapsed = Math.min(0.1, (now - lastWall) / 1000); // never try to catch up more than 100 ms
  lastWall = now;
  residual += (elapsed * rate) / DT;
  const n = Math.floor(residual);
  residual -= n;
  if (n > 0) {
    const w = performance.now();
    advance(n);
    perfWall += performance.now() - w;
    perfSteps += n;
  }
  if (now - lastPublish >= 15) { lastPublish = now; publish(); }
  if (now - perfT0 > 2000) {
    if (perfWall > 0) post({ type: 'perf', realTimeFactor: (perfSteps * DT * 1000) / perfWall, stepsPerSecond: (perfSteps * 1000) / (now - perfT0) });
    perfT0 = now; perfSteps = 0; perfWall = 0;
  }
  setTimeout(tick, 4);
}

async function init(m: Extract<Request, { type: 'init' }>): Promise<InitResult> {
  const t0 = performance.now();
  role = m.role;
  const base = m.base.endsWith('/') ? m.base : m.base + '/';
  // The bundler emits the wasm as a static asset; its URL can come back root-relative and the worker
  // itself may run from a blob: URL, so resolve it against the page origin (taken from `base`).
  const wasmUrl = new URL(new URL('../../node_modules/@mujoco/mujoco/mujoco.wasm', import.meta.url).href, m.base).href;
  const [mujoco, assets] = await Promise.all([
    loadMujoco({ locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p) }),
    loadRobotAssets(async (p) => {
      const r = await fetch(base + p);
      if (!r.ok) throw new Error(`fetch ${base + p}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }),
  ]);
  engine = Engine.create({ mujoco, assets });
  if (m.shared && role === 'live' && self.crossOriginIsolated) {
    shared = new SharedArrayBuffer(8 + 3 * SLOT * 4);
    sharedCtl = new Int32Array(shared, 0, 2);
    sharedF = new Float32Array(shared, 8, 3 * SLOT);
  }
  publish();
  return { loadMs: performance.now() - t0, robotVisuals: engine.robotVisuals, layout: engine.layout, shared, slotFloats: SLOT };
}

function sceneResult(r: { compileMs: number }): SceneResult {
  return { layout: engine!.layout, compileMs: r.compileMs, entities: engine!.entityInfo() };
}

async function handle(m: Request): Promise<unknown> {
  if (m.type === 'init') return init(m);
  if (m.type === 'parseGlb') return glbToParts(new Uint8Array(m.bytes), m.options);
  if (!engine) throw new Error('sim not initialised');
  const e = engine;
  switch (m.type) {
    case 'setScene': {
      const count = (m.scene.objects?.length ?? 0) + (m.scene.movers?.length ?? 0);
      if (count + e.robotVisuals.length > MAX_POSES) throw new Error(`too many objects (max ${MAX_POSES - e.robotVisuals.length})`);
      endReplay(null);
      const r = sceneResult(e.setScene(m.scene, { keepRobot: m.keepRobot }));
      post({ type: 'layout', layout: e.layout });
      lastStatus = '';
      publish();
      return r;
    }
    case 'reset': endReplay(null); e.reset({ start: m.start }); lastStatus = ''; residual = 0; publish(); return null;
    case 'setMode': e.setMode(m.mode); return null;
    case 'setCommand': e.setCommand(m.cmd); return null;
    case 'setGoal': e.setGoal(m.x, m.y); publish(); return null;
    case 'setSpeed': e.setSpeed(m.speed); return null;
    case 'setRate': rate = Math.max(0, Math.min(8, m.rate)); return null;
    case 'play':
      if (!playing) { playing = true; lastWall = performance.now(); perfT0 = lastWall; residual = 0; setTimeout(tick, 0); }
      return null;
    case 'pause': playing = false; publish(); return null;
    case 'push': e.push(m.force, m.angle, m.duration); return null;
    case 'getPlan': return e.plan ? Float32Array.from(e.plan) : null;
    case 'replayTrial': {
      endReplay(null);
      playing = false;
      const before = JSON.stringify(e.layout);
      e.setScene(m.options.scene);
      if (JSON.stringify(e.layout) !== before) post({ type: 'layout', layout: e.layout });
      const run = e.beginTrial(m.options, m.index);
      lastStatus = '';
      residual = 0;
      publish();
      post({ type: 'replay', phase: 'start', index: m.index, result: null });
      const done = new Promise<TrialResult | null>((resolve) => {
        replay = { run, tailLeft: Math.round((m.tail ?? 1.5) / DT), resolve };
      });
      playing = true;
      lastWall = performance.now();
      perfT0 = lastWall;
      setTimeout(tick, 0);
      return done;
    }
    case 'runTrials': {
      if (role === 'live') endReplay(null);
      const wasPlaying = playing;
      playing = false;
      const summary = e.runTrials(m.options, (done, result) => post({ type: 'trialProgress', id: m.id, done, n: m.options.n, result }));
      if (wasPlaying && role === 'live') { playing = true; lastWall = performance.now(); setTimeout(tick, 0); }
      return summary;
    }
  }
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const m = ev.data;
  try {
    const result = await handle(m);
    post({ type: 'reply', id: m.id, ok: true, result });
  } catch (err) {
    post({ type: 'reply', id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
