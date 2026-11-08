// The arena talks to physics through this interface; the implementation wraps the sim worker client.
import type { FrameLayout, NavMode, RobotVisual, SceneSpec, TrialOptions, TrialSummary, ContactEvent, Command } from "@/sim/types";

export type FrameHeader = {
  t: number;
  status: "running" | "fell" | "goal";
  pelvis: [number, number, number];
  speed: number;
  contacts: number;
};

export interface ArenaSim {
  init(): Promise<{ robotVisuals: RobotVisual[] }>;
  setScene(scene: SceneSpec): Promise<FrameLayout>;
  setMode(mode: NavMode): void;
  setCommand(cmd: Command): void;
  play(): void;
  pause(): void;
  reset(): void;
  /** called at display rate with the latest frame */
  onFrame(cb: (buf: Float32Array, layout: FrameLayout, h: FrameHeader) => void): () => void;
  onContact(cb: (c: ContactEvent) => void): () => void;
  /** planner path for the current scene (MuJoCo xy pairs), if the planner is on */
  path(): Promise<number[] | null>;
  runTrials(opts: Omit<TrialOptions, "scene"> & { scene?: SceneSpec }, onProgress?: (done: number, last?: TrialSummary["trials"][number]) => void): Promise<TrialSummary>;
  /** replay trial `index` of the last runTrials in the live view, exactly */
  replay(index: number): Promise<TrialSummary["trials"][number] | null>;
  onPush(cb: (e: { t: number; force: number; angle: number }) => void): () => void;
  dispose(): void;
}

export async function createArenaSim(): Promise<ArenaSim> {
  const mod = await import("./simClientAdapter");
  return mod.create();
}
