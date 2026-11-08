// Shared types for the Proving Ground sim engine. No DOM, no MuJoCo imports.
// World frame is MuJoCo's: meters, Z up, robot starts facing +X.

/** One convex collision part. Points are in the object frame (meters, Z up). MuJoCo hulls them. */
export interface CollisionPart {
  points: Float32Array; // xyz xyz ...
  name?: string;
  /** Hull volume in m^3. Filled in by prepareParts() if missing. */
  volume?: number;
  /** Closed mesh volume (m³) from the pipeline, when known; used to spot concave frames (see framePosts). */
  meshVolume?: number;
}

/** A placed object. The object frame origin sits at (x, y, z) with rotation yaw about Z. */
export interface SceneObject {
  id: string;
  name?: string;
  parts: CollisionPart[];
  x: number;
  y: number;
  /** Optional height of the object frame origin. Default: rest the lowest point on the floor. */
  z?: number;
  yaw?: number; // radians
  /** kg/m^3 over total hull volume. Default 400 (household). Mass is clamped to 0.05..80 kg. */
  density?: number;
  /** Explicit total mass in kg (overrides density, still clamped). */
  mass?: number;
  /** Fixed objects never move (walls, counters). Built as mocap bodies so trials can jitter them. */
  fixed?: boolean;
  friction?: number; // default 0.8
  /**
   * Lux3D articulation joints (from parts.json, Y-up object frame like the GLB). When present the object's
   * base stands fixed and each child part hangs on a damped hinge (or slide) the robot can push.
   */
  joints?: ArticulationJoint[];
}

export interface ArticulationJoint {
  type: string; // "revolute" | "continuous" | "prismatic"
  child: number; // part index (parts.json order)
  pivot: [number, number, number];
  axis: [number, number, number];
  lower: number;
  upper: number;
}

export interface PathKey { x: number; y: number; yaw: number; t: number }

/** A kinematic obstacle that follows a path (pedestrian, swinging door) and pushes the robot. */
export interface MoverSpec {
  id: string;
  name?: string;
  parts: CollisionPart[];
  path: PathKey[]; // t in seconds, ascending, path[0].t is usually 0
  loop?: boolean; // default true: time wraps at the last key
  /** Height of the mover frame origin (default: lowest point on the floor). */
  z?: number;
}

export interface Pose2 { x: number; y: number; yaw: number }

export interface SceneSpec {
  objects: SceneObject[];
  movers?: MoverSpec[];
  /** Robot start pose (default 0,0,0). */
  start?: Pose2;
  /** Goal xy (default 4, 0). */
  goal?: { x: number; y: number };
}

export interface Command { vx: number; vy: number; yaw: number }

export type NavMode = 'blind' | 'planner' | 'manual';

export type RobotStatus = 'running' | 'fell' | 'goal';

export interface ContactEvent {
  t: number;
  entityId: string; // object or mover id
  entityName: string;
  kind: 'object' | 'mover';
  /** Peak normal force (N) seen during this touch. */
  peakForce: number;
  /** Approximate impulse (N s) accumulated during this touch. */
  impulse: number;
  robotBody: string; // which robot body touched it
}

export interface StepInfo {
  t: number;
  status: RobotStatus;
  fellAt: number | null;
  goalAt: number | null;
  /** Contacts that started during this call. */
  newContacts: ContactEvent[];
  /** Pushes that started during this call. */
  newPushes: PushEvent[];
  cmd: Command;
}

/** A horizontal shove on the pelvis. angle is the world-frame direction (rad, from +X toward +Y). */
export interface PushEvent { t: number; force: number; angle: number; duration: number }

/** An in-progress trial (Engine.beginTrial / advanceTrial). */
export interface TrialRun {
  options: TrialOptions;
  index: number;
  seed: number;
  start: Pose2;
  pushes: { t: number; force: number; angle: number }[];
  total: number; // physics steps
  path: number[];
  result: TrialResult | null;
}

export interface JitterSpec {
  startPos?: number; // +- m, default 0.1
  startYaw?: number; // +- rad, default 10 deg
  objectPos?: number; // +- m, default 0
  objectYaw?: number; // +- rad, default 0
}

export interface PushSpec {
  /** Pushes per trial (default 1). */
  count?: number;
  force?: number; // N, default 120
  duration?: number; // s, default 0.2
}

export interface TrialOptions {
  scene: SceneSpec;
  n: number;
  seed: number;
  mode: 'blind' | 'planner';
  jitter?: JitterSpec;
  pushes?: PushSpec | null;
  maxSeconds?: number; // default 20
  speed?: number; // forward speed used by the navigator (default 0.5 m/s)
}

export interface TrialResult {
  index: number;
  seed: number;
  result: 'goal' | 'fell' | 'timeout';
  time: number; // sim seconds until result
  fallPoint: [number, number] | null;
  firstContactObject: string | null; // entity id
  /** Entity touched within 1.5 s before the fall, if any ("tripped on"). */
  fallCause: string | null;
  contacts: ContactEvent[];
  path: Float32Array; // x,y pairs at 2 Hz
  start: Pose2;
  pushes: { t: number; force: number; angle: number }[];
}

export interface TrialSummary {
  trials: TrialResult[];
  passRate: number; // goals / n
  falls: number;
  timeouts: number;
  meanTimeToGoal: number | null;
  wallMs: number;
  simSeconds: number;
}

/**
 * Layout of the frame buffer: [HEADER floats | robot visual geoms * 7 | objects * 7 | movers * 7].
 * Each pose is x y z qw qx qy qz in MuJoCo world coordinates (Z up).
 */
export interface FrameLayout {
  /** Floats per frame. */
  length: number;
  /** Header floats before the first pose (see H_* indices in engine.ts). */
  header: number;
  /** Number of robot visual geoms (same order as robotVisuals). */
  robotGeoms: number;
  objects: string[]; // SceneObject ids in scene order
  movers: string[]; // MoverSpec ids in scene order
  /** One float per hinge after the mover poses: the joint position (rad or m), in this order. */
  hinges?: { id: string; joint: ArticulationJoint }[];
}

/**
 * One robot visual mesh. Draw /g1/meshes/<mesh> with the per-frame pose of entry geomId.
 * The STL vertices are in the geom frame given by (pos, quat) relative to the body; the per-frame
 * pose already includes that offset.
 */
export interface RobotVisual {
  geomId: number; // index into the robot section of the frame buffer
  body: string;
  mesh: string; // file name under /g1/meshes/, e.g. left_knee_link_vis.stl
  rgba: [number, number, number, number];
  pos: [number, number, number]; // geom offset in the body frame
  quat: [number, number, number, number]; // w x y z, geom rotation in the body frame
}
