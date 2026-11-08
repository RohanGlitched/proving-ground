// Message protocol between the UI thread (client.ts) and the sim worker (worker.ts).
import type { Command, ContactEvent, FrameLayout, NavMode, Pose2, RobotStatus, RobotVisual, SceneSpec, TrialOptions, TrialResult, TrialSummary } from './types';

/** Max poses a frame slot can hold (robot visual geoms + objects + movers). */
export const MAX_POSES = 512;

export type Request =
  | { type: 'init'; id: number; base: string; role: 'live' | 'trials'; shared: boolean }
  | { type: 'setScene'; id: number; scene: SceneSpec; keepRobot?: boolean }
  | { type: 'reset'; id: number; start?: Pose2 }
  | { type: 'setMode'; id: number; mode: NavMode }
  | { type: 'setCommand'; id: number; cmd: Partial<Command> }
  | { type: 'setGoal'; id: number; x: number; y: number }
  | { type: 'setSpeed'; id: number; speed: number }
  | { type: 'setRate'; id: number; rate: number }
  | { type: 'play'; id: number }
  | { type: 'pause'; id: number }
  | { type: 'push'; id: number; force: number; angle: number; duration?: number }
  | { type: 'getPlan'; id: number }
  | { type: 'runTrials'; id: number; options: TrialOptions };

export interface InitResult {
  loadMs: number;
  robotVisuals: RobotVisual[];
  layout: FrameLayout;
  /** Present when the page is crossOriginIsolated: 3 frame slots + Int32 control word. */
  shared: SharedArrayBuffer | null;
  slotFloats: number;
}

export interface SceneResult {
  layout: FrameLayout;
  compileMs: number;
  entities: { id: string; name: string; kind: 'object' | 'mover'; fixed: boolean; mass: number; volume: number; parts: number }[];
}

export type WorkerEvent =
  | { type: 'reply'; id: number; ok: true; result: unknown }
  | { type: 'reply'; id: number; ok: false; error: string }
  | { type: 'frame'; buf: Float32Array } // only when not using SharedArrayBuffer
  | { type: 'status'; status: RobotStatus; t: number }
  | { type: 'contact'; event: ContactEvent }
  | { type: 'trialProgress'; id: number; done: number; n: number; result: TrialResult }
  | { type: 'perf'; realTimeFactor: number; stepsPerSecond: number };

export type { TrialSummary };
