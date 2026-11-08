// Promise-based client for the sim worker. Import this from UI code (client components only).
//
//   const sim = createSim();            // spawns the live worker, loads MuJoCo + G1
//   await sim.ready;                     // { robotVisuals, layout, loadMs }
//   await sim.setScene({ objects, goal: { x: 4, y: 0 } });
//   sim.setMode('planner'); sim.play();
//   // in your render loop:
//   const f = sim.latest(); if (f) { f.poses ... f.header.fallen ... }
//   const summary = await sim.runTrials({ scene, n: 10, seed: 1, mode: 'planner' }, (done, n, r) => {});
import {
  HEADER, H_CONTACTS, H_FELL_AT, H_GOAL_AT, H_GOAL_REACHED, H_GOAL_X, H_GOAL_Y, H_LAST_CONTACT, H_LAST_CONTACT_T,
  H_PELVIS_X, H_PELVIS_Y, H_PELVIS_Z, H_ROBOT_YAW, H_SEQ, H_STATUS, H_TIME, H_VX, H_VY, H_YAW, H_FALLEN,
} from './frame';
import type { InitResult, Request, SceneResult, WorkerEvent } from './protocol';
import type { Command, ContactEvent, FrameLayout, NavMode, Pose2, RobotStatus, RobotVisual, SceneSpec, TrialOptions, TrialResult, TrialSummary } from './types';

import type { GlbOptions, ObjectAsset } from './assets';

export type { InitResult, SceneResult, GlbOptions, ObjectAsset };
export * from './types';
export * from './frame';

export interface FrameHeader {
  simTime: number;
  status: RobotStatus;
  fallen: boolean;
  reachedGoal: boolean;
  robotPelvis: [number, number, number]; // Z-up world
  robotYaw: number;
  cmd: Command;
  goal: { x: number; y: number };
  /** Most recent robot contact: index into [objects..., movers...] of the layout, id and time. */
  lastContact: { index: number; id: string; kind: 'object' | 'mover'; t: number } | null;
  contactCount: number;
  fellAt: number | null;
  goalAt: number | null;
  seq: number;
}

export interface Frame {
  header: FrameHeader;
  /**
   * [robot visual geoms * 7 | objects * 7 | movers * 7], each x y z qw qx qy qz in MuJoCo Z-up world.
   * Robot entry i belongs to robotVisuals[i]. A view: copy it if you keep it past the next latest().
   */
  poses: Float32Array;
  layout: FrameLayout;
}

export interface SimClient {
  ready: Promise<InitResult>;
  robotVisuals: RobotVisual[];
  layout: FrameLayout;
  setScene(scene: SceneSpec, opts?: { keepRobot?: boolean }): Promise<SceneResult>;
  reset(start?: Pose2): Promise<void>;
  setMode(mode: NavMode): Promise<void>;
  setCommand(cmd: Partial<Command>): Promise<void>;
  setGoal(x: number, y: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  /** Sim speed multiplier for the live loop (0..8, default 1). */
  setRate(rate: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  push(force: number, angle: number, duration?: number): Promise<void>;
  /** Planned path (flat xy, Z-up world) or null. */
  getPlan(): Promise<Float32Array | null>;
  /** Latest frame (pull from your render loop). Returns the same frame until a new one arrives. */
  latest(): Frame | null;
  /** True if a frame newer than the last latest() call is waiting. */
  hasNewFrame(): boolean;
  onContact(cb: (e: ContactEvent) => void): () => void;
  onStatus(cb: (s: RobotStatus, t: number) => void): () => void;
  onPerf(cb: (p: { realTimeFactor: number; stepsPerSecond: number }) => void): () => void;
  /** Runs trials in a separate worker so the live view keeps running. */
  runTrials(options: TrialOptions, onProgress?: (done: number, n: number, r: TrialResult) => void): Promise<TrialSummary>;
  /** GLB bytes -> collision parts (Z-up), off the main thread (in the trials worker). The buffer is transferred. */
  parseGlb(bytes: ArrayBuffer, options?: GlbOptions): Promise<ObjectAsset>;
  dispose(): void;
}

export interface SimOptions {
  /** URL prefix of the G1 assets (default '/g1/'). */
  base?: string;
  /** Use SharedArrayBuffer frames when the page is crossOriginIsolated (default true). */
  shared?: boolean;
}

function spawn() {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'proving-ground-sim' });
}

class Rpc {
  private next = 1;
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  progress = new Map<number, (done: number, n: number, r: TrialResult) => void>();
  constructor(readonly worker: Worker, private onEvent: (e: WorkerEvent) => void) {
    worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
      const m = ev.data;
      if (m.type === 'reply') {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        this.progress.delete(m.id);
        if (m.ok) p.res(m.result);
        else p.rej(new Error(m.error));
      } else if (m.type === 'trialProgress') {
        this.progress.get(m.id)?.(m.done, m.n, m.result);
      } else onEvent(m);
    };
    worker.onerror = (ev) => {
      const err = new Error(`sim worker error: ${ev.message}`);
      for (const p of this.pending.values()) p.rej(err);
      this.pending.clear();
    };
  }
  call<T>(msg: Record<string, unknown> & { type: Request['type'] }, onProgress?: (done: number, n: number, r: TrialResult) => void, transfer: Transferable[] = []): Promise<T> {
    const id = this.next++;
    if (onProgress) this.progress.set(id, onProgress);
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res: res as (v: unknown) => void, rej });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }
}

export function decodeHeader(b: Float32Array, layout: FrameLayout): FrameHeader {
  const li = b[H_LAST_CONTACT] | 0;
  const nObj = layout.objects.length;
  const lastContact = li >= 0 ? {
    index: li,
    id: li < nObj ? layout.objects[li] : layout.movers[li - nObj],
    kind: (li < nObj ? 'object' : 'mover') as 'object' | 'mover',
    t: b[H_LAST_CONTACT_T],
  } : null;
  const st = b[H_STATUS];
  return {
    simTime: b[H_TIME],
    status: st === 1 ? 'fell' : st === 2 ? 'goal' : 'running',
    fallen: b[H_FALLEN] === 1,
    reachedGoal: b[H_GOAL_REACHED] === 1,
    robotPelvis: [b[H_PELVIS_X], b[H_PELVIS_Y], b[H_PELVIS_Z]],
    robotYaw: b[H_ROBOT_YAW],
    cmd: { vx: b[H_VX], vy: b[H_VY], yaw: b[H_YAW] },
    goal: { x: b[H_GOAL_X], y: b[H_GOAL_Y] },
    lastContact,
    contactCount: b[H_CONTACTS],
    fellAt: b[H_FELL_AT] >= 0 ? b[H_FELL_AT] : null,
    goalAt: b[H_GOAL_AT] >= 0 ? b[H_GOAL_AT] : null,
    seq: b[H_SEQ],
  };
}

export function createSim(opts: SimOptions = {}): SimClient {
  // absolute: module workers may run from a blob: URL where '/g1/' does not resolve
  const base = new URL(opts.base ?? '/g1/', globalThis.location?.href ?? 'http://localhost/').href;
  const contactCbs = new Set<(e: ContactEvent) => void>();
  const statusCbs = new Set<(s: RobotStatus, t: number) => void>();
  const perfCbs = new Set<(p: { realTimeFactor: number; stepsPerSecond: number }) => void>();
  let lastBuf: Float32Array | null = null;
  let lastSeq = -1;
  let frame: Frame | null = null;
  let sharedF: Float32Array | null = null, sharedCtl: Int32Array | null = null, slotFloats = 0;

  const rpc = new Rpc(spawn(), (m) => {
    if (m.type === 'frame') lastBuf = m.buf;
    else if (m.type === 'contact') contactCbs.forEach((cb) => cb(m.event));
    else if (m.type === 'status') statusCbs.forEach((cb) => cb(m.status, m.t));
    else if (m.type === 'perf') perfCbs.forEach((cb) => cb(m));
  });
  let trialsRpc: Rpc | null = null;
  let trialsReady: Promise<unknown> | null = null;
  const trials = async () => {
    if (!trialsRpc) {
      trialsRpc = new Rpc(spawn(), () => {});
      trialsReady = trialsRpc.call({ type: 'init', base, role: 'trials', shared: false });
    }
    await trialsReady;
    return trialsRpc;
  };

  const client: SimClient = {
    ready: null as unknown as Promise<InitResult>,
    robotVisuals: [],
    layout: { length: HEADER, header: HEADER, robotGeoms: 0, objects: [], movers: [] },
    async setScene(scene, o = {}) {
      await client.ready;
      const r = await rpc.call<SceneResult>({ type: 'setScene', scene, keepRobot: o.keepRobot });
      client.layout = r.layout;
      return r;
    },
    async reset(start) { await client.ready; await rpc.call({ type: 'reset', start }); },
    async setMode(mode) { await client.ready; await rpc.call({ type: 'setMode', mode }); },
    async setCommand(cmd) { await client.ready; await rpc.call({ type: 'setCommand', cmd }); },
    async setGoal(x, y) { await client.ready; await rpc.call({ type: 'setGoal', x, y }); },
    async setSpeed(speed) { await client.ready; await rpc.call({ type: 'setSpeed', speed }); },
    async setRate(rate) { await client.ready; await rpc.call({ type: 'setRate', rate }); },
    async play() { await client.ready; await rpc.call({ type: 'play' }); },
    async pause() { await client.ready; await rpc.call({ type: 'pause' }); },
    async push(force, angle, duration) { await client.ready; await rpc.call({ type: 'push', force, angle, duration }); },
    async getPlan() { await client.ready; return rpc.call<Float32Array | null>({ type: 'getPlan' }); },
    hasNewFrame() {
      if (sharedCtl) return Atomics.load(sharedCtl, 1) !== lastSeq;
      return !!lastBuf && lastBuf[H_SEQ] !== lastSeq;
    },
    latest() {
      const layout = client.layout;
      let b: Float32Array | null = null;
      let seq: number;
      if (sharedF && sharedCtl) {
        seq = Atomics.load(sharedCtl, 1);
        if (seq === lastSeq && frame) return frame;
        const s = Atomics.load(sharedCtl, 0);
        b = sharedF.subarray(s * slotFloats, s * slotFloats + layout.length);
      } else {
        if (!lastBuf) return frame;
        seq = lastBuf[H_SEQ];
        if (seq === lastSeq && frame) return frame;
        b = lastBuf;
      }
      if (b.length < layout.length) return frame; // a frame from before a scene change
      lastSeq = seq;
      frame = { header: decodeHeader(b, layout), poses: b.subarray(HEADER, layout.length), layout };
      return frame;
    },
    onContact(cb) { contactCbs.add(cb); return () => contactCbs.delete(cb); },
    onStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); },
    onPerf(cb) { perfCbs.add(cb); return () => perfCbs.delete(cb); },
    async runTrials(options, onProgress) {
      const t = await trials();
      return t.call<TrialSummary>({ type: 'runTrials', options }, onProgress);
    },
    async parseGlb(bytes, options) {
      const t = await trials();
      return t.call<ObjectAsset>({ type: 'parseGlb', bytes, options }, undefined, [bytes]);
    },
    dispose() {
      rpc.worker.terminate();
      trialsRpc?.worker.terminate();
    },
  };
  client.ready = rpc.call<InitResult>({ type: 'init', base, role: 'live', shared: opts.shared !== false }).then((r) => {
    client.robotVisuals = r.robotVisuals;
    client.layout = r.layout;
    if (r.shared) {
      sharedCtl = new Int32Array(r.shared, 0, 2);
      sharedF = new Float32Array(r.shared, 8, 3 * r.slotFloats);
      slotFloats = r.slotFloats;
    }
    return r;
  });
  return client;
}
