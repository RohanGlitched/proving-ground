// Proving Ground sim engine: MuJoCo WASM + Unitree G1 walking policy + user objects + navigation + trials.
// No DOM. Runs in a Web Worker in the browser and in Node for tests.
import type { MainModule, MjData, MjModel } from '@mujoco/mujoco';
import { boundedHull, hull2d } from './hull';
import { blindCommand, buildGrid, DEFAULT_NAV, pathBlocked, planPath, pursuitCommand, type Grid, type NavConfig } from './nav';
import {
  ACTION_SCALE, ANG_VEL_SCALE, CMD_SCALE, DECIMATION, DEFAULT_ANGLES, DOF_POS_SCALE, DOF_VEL_SCALE, DT, GATE_NOISE,
  KD, KP, packWeights, PHASE_PERIOD, Policy, projectedGravity, type PackedWeights,
} from './policy';
import { Rng, mixSeed } from './rng';
import { parseRobotVisuals, physicsXml, type RobotAssets } from './robot';
import type {
  ArticulationJoint, CollisionPart, Command, ContactEvent, FrameLayout, MoverSpec, NavMode, Pose2, PushEvent, RobotStatus, RobotVisual, SceneObject,
  SceneSpec, StepInfo, TrialOptions, TrialResult, TrialRun, TrialSummary,
} from './types';

export * from './types';

import {
  HEADER, H_CONTACTS, H_FALLEN, H_FELL_AT, H_GOAL_AT, H_GOAL_REACHED, H_GOAL_X, H_GOAL_Y, H_LAST_CONTACT, H_LAST_CONTACT_T,
  H_PELVIS_X, H_PELVIS_Y, H_PELVIS_Z, H_RESERVED, H_ROBOT_YAW, H_SEQ, H_STATUS, H_TIME, H_VX, H_VY, H_YAW, STATUS_CODE,
} from './frame';

export * from './frame';

export const FALL_HEIGHT = 0.45; // pelvis z (m)
export const FALL_GRAVITY = -0.5; // projected gravity z above this = tipped over
export const GOAL_RADIUS = 0.4; // m
export const DEFAULT_DENSITY = 400; // kg/m^3 over hull volume
export const MASS_MIN = 0.05, MASS_MAX = 80;
export const MAX_PART_VERTS = 96; // hull vertices kept per part (MuJoCo hulls them again)

export interface PreparedPart { verts: Float32Array; volume: number; minZ: number; maxZ: number; fill?: number }

interface Entity {
  index: number;
  id: string;
  name: string;
  kind: 'object' | 'mover';
  fixed: boolean; // mocap
  parts: PreparedPart[];
  bodyId: number; // -1 when the object had no usable parts (it is then not simulated)
  qadr: number; // free joint qpos address, -1 for mocap
  vadr: number;
  mocapId: number;
  pose: { x: number; y: number; z: number; yaw: number }; // spawn pose
  mass: number;
  volume: number;
  radius: number; // max xy distance of any hull vertex from the origin
  mover?: MoverSpec;
  /** articulated objects: one entry per hinge (child body, joint qpos address) */
  hinges?: { joint: ArticulationJoint; body: number; qadr: number; name: string }[];
}

const prepCache = new WeakMap<CollisionPart, PreparedPart | null>();

/** Hulls each part once (cached per part object). Drops parts smaller than 1 cm. */
export function prepareParts(parts: CollisionPart[]): PreparedPart[] {
  const out: PreparedPart[] = [];
  for (const p of parts) {
    let r = prepCache.get(p);
    if (r === undefined) {
      r = null;
      if (p.points.length >= 12) {
        const h = boundedHull(p.points, MAX_PART_VERTS);
        let minZ = Infinity, maxZ = -Infinity;
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < h.verts.length; i += 3) {
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], h.verts[i + k]); mx[k] = Math.max(mx[k], h.verts[i + k]); }
          minZ = Math.min(minZ, h.verts[i + 2]); maxZ = Math.max(maxZ, h.verts[i + 2]);
        }
        if (Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) >= 0.01) r = { verts: h.verts, volume: p.volume ?? h.volume, minZ, maxZ, ...(p.meshVolume && h.volume > 0 ? { fill: p.meshVolume / h.volume } : {}) };
      }
      prepCache.set(p, r);
    }
    if (r) out.push(r);
  }
  return out;
}

const fmt = (v: number) => String(Math.round(v * 1e5) / 1e5);

/**
 * Lux3D people are rigged in a T-pose, so their bind-pose mesh is up to 1.8 m wide at the arms. The walk clip
 * keeps the arms at the sides, so a walker collides as its body within 0.3 m of the centre line (a 0.6 m box
 * in plan); height is unchanged. Cached per part so the hull is built once.
 */
const torsoCache = new WeakMap<CollisionPart, CollisionPart>();
function torsoParts(parts: CollisionPart[]): CollisionPart[] {
  const H = 0.3;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of parts) for (let i = 0; i < p.points.length; i += 3) {
    x0 = Math.min(x0, p.points[i]); x1 = Math.max(x1, p.points[i]); y0 = Math.min(y0, p.points[i + 1]); y1 = Math.max(y1, p.points[i + 1]);
  }
  if (x1 - x0 <= 2 * H && y1 - y0 <= 2 * H) return parts;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return parts.map((p) => {
    let q = torsoCache.get(p);
    if (!q) {
      const pts = Float32Array.from(p.points);
      for (let i = 0; i < pts.length; i += 3) {
        pts[i] = Math.min(cx + H, Math.max(cx - H, pts[i]));
        pts[i + 1] = Math.min(cy + H, Math.max(cy - H, pts[i + 1]));
      }
      q = { points: pts, name: p.name };
      torsoCache.set(p, q);
    }
    return q;
  });
}

/**
 * A door or gate frame is one concave Lux3D part, and its convex hull would fill the doorway. When the mesh
 * fills under 45% of its hull, collide with two posts at the ends of its width instead (full height and
 * depth, thickness from the measured mesh volume). Returns null for solid parts.
 */
export function framePosts(p: PreparedPart): PreparedPart[] | null {
  if (p.fill === undefined || p.fill >= 0.45) return null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.verts.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.verts[i + k]); mx[k] = Math.max(mx[k], p.verts[i + k]); }
  const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const w = ext[0] >= ext[1] ? 0 : 1, d = 1 - w; // width and depth axes in the floor plane
  const meshVolume = p.fill * p.volume; // p.volume is the hull's; fill = mesh / hull
  const t = Math.min(ext[w] * 0.25, Math.max(0.04, meshVolume / Math.max(1e-6, 2 * ext[2] * ext[d])));
  const box = (a0: number, a1: number): PreparedPart => {
    const v: number[] = [];
    for (const a of [a0, a1]) for (const b of [mn[d], mx[d]]) for (const z of [mn[2], mx[2]]) {
      const pt = [0, 0, z];
      pt[w] = a; pt[d] = b;
      v.push(pt[0], pt[1], pt[2]);
    }
    return { verts: Float32Array.from(v), volume: p.volume / 2, minZ: mn[2], maxZ: mx[2] };
  };
  return [box(mn[w], mn[w] + t), box(mx[w] - t, mx[w])];
}
const yawQuat = (yaw: number) => [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface EngineOptions {
  mujoco: MainModule;
  assets: RobotAssets;
  /** Directory inside the MuJoCo FS for robot files (default /pg). */
  dir?: string;
}

export interface ResetOptions {
  start?: Pose2;
  /** Joint noise: 'gate' (the Python reference noise), 'none', or an explicit 12-vector. */
  noise?: 'gate' | 'none' | number[];
  /** Per-object pose offsets {id: {dx, dy, dyaw}} applied to the spawn pose. */
  objectJitter?: Record<string, { dx: number; dy: number; dyaw: number }>;
}

export class Engine {
  readonly mujoco: MainModule;
  private weights: PackedWeights;
  private dir: string;
  readonly robotVisuals: RobotVisual[];
  private robotBodyNames: string[];
  private visBody = new Int32Array(0);

  model: MjModel | null = null;
  data: MjData | null = null;
  private entities: Entity[] = [];
  private scene: SceneSpec = { objects: [] };
  private geomOwner = new Int32Array(0); // -1 world, -2 robot, >= 0 entity index
  private robotBodyIds: number[] = [];
  private pelvisId = 1;
  layout: FrameLayout = { length: HEADER, header: HEADER, robotGeoms: 0, objects: [], movers: [] };

  // controller state
  private policy: Policy;
  private obs = new Float64Array(47);
  private act = new Float64Array(12);
  private tgt = DEFAULT_ANGLES.slice();
  private grav = [0, 0, -1];
  robotStep = 0;
  status: RobotStatus = 'running';
  fellAt: number | null = null;
  goalAt: number | null = null;
  start: Pose2 = { x: 0, y: 0, yaw: 0 };
  goal = { x: 4, y: 0 };
  mode: NavMode = 'manual';
  cmd: Command = { vx: 0, vy: 0, yaw: 0 };
  manualCmd: Command = { vx: 0, vy: 0, yaw: 0 };
  nav: NavConfig = { ...DEFAULT_NAV };
  plan: number[] | null = null;
  private grid: Grid | null = null;
  private nextReplan = 0;
  /** True while the planner is standing still to let a walker pass. */
  yielding = false;
  /** Stop the robot (zero command) once it reaches the goal. */
  stopAtGoal = true;

  // contacts
  contacts: ContactEvent[] = [];
  private touching = new Map<number, { ev: ContactEvent; last: number }>();
  private newContacts: ContactEvent[] = [];
  private forceBuf: { GetView(): Float64Array; delete(): void } | null = null;

  // pushes
  /** Pelvis pushes keyed by physics step index [s0, s1). Scheduled trial pushes use the same path. */
  private pushes: { s0: number; s1: number; fx: number; fy: number; ev: PushEvent }[] = [];
  private newPushes: PushEvent[] = [];
  private seq = 0;
  lastCompileMs = 0;

  private constructor(opts: EngineOptions) {
    this.mujoco = opts.mujoco;
    this.weights = packWeights(opts.assets.weights);
    this.policy = new Policy(this.weights);
    this.dir = opts.dir ?? '/pg';
    const vis = parseRobotVisuals(opts.assets.xml);
    this.robotVisuals = vis.visuals;
    this.robotBodyNames = vis.bodies;
    const FS = (this.mujoco as unknown as { FS: { mkdirTree(p: string, m?: number): void; writeFile(p: string, d: Uint8Array | string): void } }).FS;
    FS.mkdirTree(`${this.dir}/meshes`, 0o777);
    FS.writeFile(`${this.dir}/g1_phys.xml`, physicsXml(opts.assets.xml));
    for (const [f, b] of Object.entries(opts.assets.hulls)) FS.writeFile(`${this.dir}/meshes/${f}`, b);
  }

  static create(opts: EngineOptions): Engine {
    const e = new Engine(opts);
    e.setScene({ objects: [] });
    return e;
  }

  get time() { return this.robotStep * DT; }

  /** Builds the MJCF scene string for a scene spec (exposed for debugging and export). */
  buildXml(spec: SceneSpec): { xml: string; entities: Entity[] } {
    const assets: string[] = [];
    const bodies: string[] = [];
    const entities: Entity[] = [];
    const add = (kind: 'object' | 'mover', o: SceneObject | MoverSpec, fixedIn: boolean, mover?: MoverSpec) => {
      // articulated objects: the base stands fixed, child parts hang on joints (single level, base = parts not moved by any joint)
      const joints = !mover ? ((o as SceneObject).joints ?? []).filter((j) => j.child >= 0 && j.child < o.parts.length) : [];
      const fixed = fixedIn || joints.length > 0;
      const prepOne = (mover ? torsoParts(o.parts) : o.parts).map((p) => prepareParts([p])[0] ?? null);
      // articulated base parts that are frames collide as two posts (see framePosts)
      const prepAll: (PreparedPart | null)[] = [];
      const srcIndex: number[] = [];
      prepOne.forEach((p, pi) => {
        const posts = joints.length && p && !joints.some((j) => j.child === pi) ? framePosts(p) : null;
        for (const q of posts ?? [p]) { prepAll.push(q); srcIndex.push(pi); }
      });
      const childOf = new Map<number, number>(); // part index -> joint index
      joints.forEach((j, ji) => childOf.set(j.child, ji));
      const parts = prepAll.filter((p): p is PreparedPart => !!p);
      const index = entities.length;
      const tag = `pg_${kind[0]}${index}`;
      let minZ = Infinity, volume = 0, radius = 0;
      for (const p of parts) {
        minZ = Math.min(minZ, p.minZ);
        volume += p.volume;
        for (let i = 0; i < p.verts.length; i += 3) radius = Math.max(radius, Math.hypot(p.verts[i], p.verts[i + 1]));
      }
      const so = o as SceneObject;
      const x = mover ? mover.path[0]?.x ?? 0 : so.x;
      const y = mover ? mover.path[0]?.y ?? 0 : so.y;
      const yaw = mover ? mover.path[0]?.yaw ?? 0 : so.yaw ?? 0;
      const z = o.z ?? -minZ + (fixed ? 0 : 0.002);
      const mass = Math.min(MASS_MAX, Math.max(MASS_MIN, so.mass ?? volume * (so.density ?? DEFAULT_DENSITY)));
      const fr = so.friction ?? 0.8;
      const q = yawQuat(yaw);
      const ent: Entity = {
        index, id: o.id, name: o.name ?? o.id, kind, fixed, parts, bodyId: -1, qadr: -1, vadr: -1, mocapId: -1,
        pose: { x, y, z: parts.length ? z : 0, yaw }, mass: parts.length ? mass : 0, volume, radius, mover,
      };
      entities.push(ent);
      if (!parts.length) return;
      const geoms: string[] = [];
      const childGeoms: string[][] = joints.map(() => []);
      // Y-up object frame (parts.json) -> Z-up body frame, the same turn the parts already had
      const zup = (v: number[]) => [v[0], -v[2], v[1]];
      let k = 0;
      prepAll.forEach((p, pi) => {
        if (!p) return;
        const ji = childOf.get(srcIndex[pi]);
        const off = ji === undefined ? [0, 0, 0] : zup(joints[ji].pivot);
        const mname = `${tag}_m${k}`;
        const vs: string[] = [];
        for (let i = 0; i < p.verts.length; i++) vs.push(fmt(p.verts[i] - off[i % 3]));
        assets.push(`<mesh name="${mname}" vertex="${vs.join(' ')}"/>`);
        const g = `<geom name="${tag}_g${k}" type="mesh" mesh="${mname}" mass="${fmt(Math.max(1e-4, (mass * p.volume) / Math.max(volume, 1e-9)))}" friction="${fr} 0.005 0.0001" priority="1" condim="3" rgba="0.8 0.6 0.4 1"/>`;
        if (ji === undefined) geoms.push(g);
        else childGeoms[ji].push(g);
        k++;
      });
      const kids = joints.map((j, ji) => {
        if (!childGeoms[ji].length) return '';
        const pv = zup(j.pivot), ax = zup(j.axis);
        const slide = j.type === 'prismatic';
        const lo = Number.isFinite(j.lower) ? j.lower : 0, hi = Number.isFinite(j.upper) ? j.upper : 0;
        const limited = j.type !== 'continuous' && hi > lo;
        return `<body name="${tag}_c${ji}" pos="${pv.map(fmt).join(' ')}"><joint name="${tag}_h${ji}" type="${slide ? 'slide' : 'hinge'}" axis="${ax.map(fmt).join(' ')}"${limited ? ` limited="true" range="${fmt(lo)} ${fmt(hi)}"` : ''} damping="${slide ? 20 : 1.2}" frictionloss="0.3" armature="0.02"/>${childGeoms[ji].join('')}</body>`;
      });
      if (joints.length) ent.hinges = joints.map((j, ji) => ({ joint: j, body: -1, qadr: -1, name: `${tag}_c${ji}` })).filter((h, ji) => childGeoms[ji].length > 0);
      const head = `<body name="${tag}" pos="${fmt(x)} ${fmt(y)} ${fmt(z)}" quat="${q.map(fmt).join(' ')}"${fixed ? ' mocap="true"' : ''}>`;
      bodies.push(`${head}${fixed ? '' : `<freejoint name="${tag}_j"/>`}${geoms.join('')}${kids.join('')}</body>`);
    };
    for (const o of spec.objects) add('object', o, !!o.fixed);
    for (const m of spec.movers ?? []) add('mover', m, true, m);
    const excl = entities.filter((e) => e.fixed && e.parts.length).map((e) => `<exclude body1="world" body2="pg_${e.kind[0]}${e.index}"/>`);
    const xml = `<mujoco model="proving-ground">
<include file="g1_phys.xml"/>
<option timestep="${DT}"/>
<size memory="${Math.min(256, 16 + entities.length * 2)}M"/>
<asset>${assets.join('\n')}</asset>
<worldbody>
<geom name="floor" size="0 0 0.05" type="plane" rgba="0.5 0.5 0.5 1"/>
${bodies.join('\n')}
</worldbody>
${excl.length ? `<contact>${excl.join('')}</contact>` : ''}
</mujoco>`;
    return { xml, entities };
  }

  /**
   * Compiles a new scene. keepRobot keeps the robot's state and controller (objects that keep the same id
   * and spawn pose keep their state too); otherwise everything resets to the spawn poses.
   */
  setScene(spec: SceneSpec, opts: { keepRobot?: boolean } = {}): { compileMs: number; layout: FrameLayout } {
    const mj = this.mujoco;
    const t0 = now();
    const { xml, entities } = this.buildXml(spec);
    const FS = (mj as unknown as { FS: { writeFile(p: string, d: string): void } }).FS;
    FS.writeFile(`${this.dir}/scene.xml`, xml);
    const model = mj.MjModel.from_xml_path(`${this.dir}/scene.xml`);
    model.opt.timestep = DT;
    const data = new mj.MjData(model);
    const compileMs = now() - t0;

    const old = this.data && opts.keepRobot ? { qpos: Float64Array.from(this.data.qpos), qvel: Float64Array.from(this.data.qvel), ents: this.entities, model: this.model! } : null;
    this.forceBuf?.delete();
    this.forceBuf = null;
    this.data?.delete();
    this.model?.delete();
    this.model = model;
    this.data = data;
    this.entities = entities;
    this.scene = spec;
    if (spec.goal) this.goal = { ...spec.goal };
    if (spec.start) this.start = { ...spec.start };

    const BODY = mj.mjtObj.mjOBJ_BODY.value;
    this.pelvisId = mj.mj_name2id(model, BODY, 'pelvis');
    const rootid = model.body_rootid as Int32Array;
    this.robotBodyIds = [];
    for (let b = 1; b < model.nbody; b++) if (rootid[b] === this.pelvisId) this.robotBodyIds.push(b);
    const jntadr = model.body_jntadr as Int32Array, qposadr = model.jnt_qposadr as Int32Array, dofadr = model.jnt_dofadr as Int32Array;
    const mocapid = model.body_mocapid as Int32Array;
    for (const e of entities) {
      if (!e.parts.length) continue;
      e.bodyId = mj.mj_name2id(model, BODY, `pg_${e.kind[0]}${e.index}`);
      if (e.fixed) e.mocapId = mocapid[e.bodyId];
      else { const j = jntadr[e.bodyId]; e.qadr = qposadr[j]; e.vadr = dofadr[j]; }
      for (const h of e.hinges ?? []) {
        h.body = mj.mj_name2id(model, BODY, h.name);
        h.qadr = h.body >= 0 ? qposadr[jntadr[h.body]] : -1;
      }
    }
    const gb = model.geom_bodyid as Int32Array;
    const bodyOwner = new Int32Array(model.nbody).fill(-1);
    for (const b of this.robotBodyIds) bodyOwner[b] = -2;
    for (const e of entities) {
      if (e.bodyId >= 0) bodyOwner[e.bodyId] = e.index;
      for (const h of e.hinges ?? []) if (h.body >= 0) bodyOwner[h.body] = e.index;
    }
    this.geomOwner = new Int32Array(model.ngeom);
    for (let g = 0; g < model.ngeom; g++) this.geomOwner[g] = bodyOwner[gb[g]];

    const objIds = entities.filter((e) => e.kind === 'object').map((e) => e.id);
    const movIds = entities.filter((e) => e.kind === 'mover').map((e) => e.id);
    this.visBody = Int32Array.from(this.robotVisuals.map((v) => mj.mj_name2id(model, BODY, v.body)));
    const hinges = entities.filter((e) => e.kind === 'object').flatMap((e) => (e.hinges ?? []).filter((h) => h.qadr >= 0).map((h) => ({ id: e.id, joint: h.joint })));
    this.layout = {
      length: HEADER + 7 * (this.robotVisuals.length + objIds.length + movIds.length) + hinges.length,
      header: HEADER,
      robotGeoms: this.robotVisuals.length,
      objects: objIds,
      movers: movIds,
      ...(hinges.length ? { hinges } : {}),
    };

    if (old) {
      const q = data.qpos as Float64Array, v = data.qvel as Float64Array;
      q.set(old.qpos.subarray(0, 19), 0);
      v.set(old.qvel.subarray(0, 18), 0);
      this.placeEntities();
      for (const e of entities) {
        if (e.fixed || e.bodyId < 0) continue;
        const prev = old.ents.find((p) => p.id === e.id && !p.fixed && p.pose.x === e.pose.x && p.pose.y === e.pose.y && p.pose.yaw === e.pose.yaw && p.parts.length === e.parts.length);
        if (!prev) continue;
        q.set(old.qpos.subarray(prev.qadr, prev.qadr + 7), e.qadr);
        v.set(old.qvel.subarray(prev.vadr, prev.vadr + 6), e.vadr);
      }
      this.updateMovers(this.time);
      mj.mj_forward(model, data);
      this.touching.clear();
      this.grid = null;
      this.plan = null;
      this.nextReplan = 0; this.yielding = false;
      this.eagerPlan();
    } else {
      this.reset();
    }
    this.lastCompileMs = compileMs;
    return { compileMs, layout: this.layout };
  }

  private placeEntities(jitter?: ResetOptions['objectJitter']) {
    const q = this.data!.qpos as Float64Array;
    const mp = this.data!.mocap_pos as Float64Array, mq = this.data!.mocap_quat as Float64Array;
    for (const e of this.entities) {
      if (e.bodyId < 0) continue;
      const j = jitter?.[e.id];
      const x = e.pose.x + (j?.dx ?? 0), y = e.pose.y + (j?.dy ?? 0), yaw = e.pose.yaw + (j?.dyaw ?? 0);
      const qu = yawQuat(yaw);
      if (e.fixed) {
        mp.set([x, y, e.pose.z], 3 * e.mocapId);
        mq.set(qu, 4 * e.mocapId);
      } else {
        q.set([x, y, e.pose.z, ...qu], e.qadr);
      }
    }
  }

  /** Resets robot, objects and controller. */
  reset(opts: ResetOptions = {}) {
    const mj = this.mujoco, model = this.model!, data = this.data!;
    mj.mj_resetData(model, data);
    const s = opts.start ?? this.start;
    this.start = { ...s };
    const q = data.qpos as Float64Array;
    q[0] = s.x; q[1] = s.y;
    const rq = yawQuat(s.yaw);
    q[3] = rq[0]; q[4] = rq[1]; q[5] = rq[2]; q[6] = rq[3];
    const noise = opts.noise === 'none' ? null : Array.isArray(opts.noise) ? opts.noise : GATE_NOISE;
    for (let j = 0; j < 12; j++) q[7 + j] = DEFAULT_ANGLES[j] + (noise ? noise[j] : 0);
    this.placeEntities(opts.objectJitter);
    this.policy.reset();
    this.act.fill(0);
    this.tgt = DEFAULT_ANGLES.slice();
    this.robotStep = 0;
    this.status = 'running';
    this.fellAt = null;
    this.goalAt = null;
    this.contacts = [];
    this.touching.clear();
    this.pushes = [];
    this.plan = null;
    this.grid = null;
    this.nextReplan = 0; this.yielding = false;
    this.cmd = { vx: 0, vy: 0, yaw: 0 };
    this.updateMovers(0);
    mj.mj_forward(model, data);
    this.eagerPlan();
  }

  setMode(mode: NavMode) { this.mode = mode; this.nextReplan = 0; this.yielding = false; this.eagerPlan(); }

  /**
   * In planner mode, plans right away so getPlan() has a path before the first step. The replan schedule is
   * left at 0, so the first policy tick replans from the same state (trials stay bit-identical).
   */
  private eagerPlan() {
    if (this.mode !== 'planner' || !this.data || this.status !== 'running') return;
    this.replan(this.robotPose());
    this.nextReplan = 0; this.yielding = false;
  }
  setCommand(c: Partial<Command>) { Object.assign(this.manualCmd, c); }
  setGoal(x: number, y: number) { this.goal = { x, y }; this.nextReplan = 0; this.yielding = false; if (this.status === 'goal') { this.status = 'running'; this.goalAt = null; } this.eagerPlan(); }
  setSpeed(v: number) { this.nav.speed = v; }

  /** Applies a horizontal force to the pelvis for `duration` seconds starting now. */
  push(force: number, angle: number, duration = 0.2) {
    this.schedulePush(this.robotStep, force, angle, duration);
  }

  /** Schedules a pelvis push starting at physics step s0 (time s0 * DT). */
  schedulePush(s0: number, force: number, angle: number, duration = 0.2) {
    const ev: PushEvent = { t: s0 * DT, force, angle, duration };
    this.pushes.push({ s0, s1: s0 + Math.max(1, Math.round(duration / DT)), fx: force * Math.cos(angle), fy: force * Math.sin(angle), ev });
  }

  /** Robot pelvis pose in the plane. */
  robotPose(): Pose2 {
    const q = this.data!.qpos as Float64Array;
    return { x: q[0], y: q[1], yaw: Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6])) };
  }

  private updateMovers(t: number) {
    const d = this.data!;
    let mp: Float64Array | null = null, mq: Float64Array | null = null;
    for (const e of this.entities) {
      const m = e.mover;
      if (!m || !m.path.length || e.bodyId < 0) continue;
      mp ??= d.mocap_pos as Float64Array; mq ??= d.mocap_quat as Float64Array;
      const p = samplePath(m.path, t, m.loop !== false);
      mp[3 * e.mocapId] = p.x; mp[3 * e.mocapId + 1] = p.y; mp[3 * e.mocapId + 2] = e.pose.z;
      const qu = yawQuat(p.yaw);
      mq.set(qu, 4 * e.mocapId);
    }
  }

  /** Advances n physics steps (500 Hz). The policy and navigator run every 10th step (50 Hz). */
  step(n: number, stopWhenDone = false): StepInfo {
    const mj = this.mujoco, model = this.model!, data = this.data!;
    this.newContacts = [];
    this.newPushes = [];
    let qpos = data.qpos as Float64Array, qvel = data.qvel as Float64Array, ctrl = data.ctrl as Float64Array, xfrc = data.xfrc_applied as Float64Array;
    const pel = this.pelvisId * 6;
    const hasMovers = this.entities.some((e) => e.mover);
    for (let s = 0; s < n; s++) {
      // walkers stop where they are once the robot is down (no walking through a fallen body)
      if (hasMovers) this.updateMovers(this.status === 'fell' && this.fellAt !== null ? this.fellAt : (this.robotStep + 1) * DT);
      const k = this.robotStep;
      xfrc[pel] = 0; xfrc[pel + 1] = 0; xfrc[pel + 2] = 0; xfrc[pel + 3] = 0; xfrc[pel + 4] = 0; xfrc[pel + 5] = 0;
      for (const p of this.pushes) {
        if (k === p.s0) this.newPushes.push(p.ev);
        if (k >= p.s0 && k < p.s1) { xfrc[pel] += p.fx; xfrc[pel + 1] += p.fy; }
      }
      const tgt = this.tgt;
      for (let j = 0; j < 12; j++) ctrl[j] = (tgt[j] - qpos[7 + j]) * KP[j] - qvel[6 + j] * KD[j];
      mj.mj_step(model, data);
      this.robotStep++;
      if (this.robotStep % DECIMATION === 0) {
        if (this.scanContacts()) {
          qpos = data.qpos as Float64Array; qvel = data.qvel as Float64Array; ctrl = data.ctrl as Float64Array; xfrc = data.xfrc_applied as Float64Array;
        }
        this.navigate();
        if (this.status !== 'fell') this.policyTick(qpos, qvel);
      }
      if (this.status !== 'fell') {
        projectedGravity(qpos[3], qpos[4], qpos[5], qpos[6], this.grav);
        if (qpos[2] < FALL_HEIGHT || this.grav[2] > FALL_GRAVITY) {
          this.status = 'fell';
          this.fellAt = this.robotStep * DT - DT;
          this.tgt = DEFAULT_ANGLES.slice(); // go stiff; the policy stops
        } else if (this.status === 'running' && Math.hypot(qpos[0] - this.goal.x, qpos[1] - this.goal.y) < GOAL_RADIUS && this.mode !== 'manual') {
          this.status = 'goal';
          this.goalAt = this.robotStep * DT;
        }
      }
      if (stopWhenDone && this.status !== 'running') break;
    }
    if (this.pushes.length && this.pushes.every((p) => p.s1 <= this.robotStep)) this.pushes = [];
    return { t: this.time, status: this.status, fellAt: this.fellAt, goalAt: this.goalAt, newContacts: this.newContacts, newPushes: this.newPushes, cmd: { ...this.cmd } };
  }

  private policyTick(qpos: Float64Array, qvel: Float64Array) {
    const obs = this.obs, act = this.act, cmd = this.cmd;
    const ph = ((this.robotStep * DT) % PHASE_PERIOD) / PHASE_PERIOD;
    projectedGravity(qpos[3], qpos[4], qpos[5], qpos[6], this.grav);
    obs[0] = qvel[3] * ANG_VEL_SCALE; obs[1] = qvel[4] * ANG_VEL_SCALE; obs[2] = qvel[5] * ANG_VEL_SCALE;
    obs[3] = this.grav[0]; obs[4] = this.grav[1]; obs[5] = this.grav[2];
    obs[6] = cmd.vx * CMD_SCALE[0]; obs[7] = cmd.vy * CMD_SCALE[1]; obs[8] = cmd.yaw * CMD_SCALE[2];
    for (let j = 0; j < 12; j++) {
      obs[9 + j] = (qpos[7 + j] - DEFAULT_ANGLES[j]) * DOF_POS_SCALE;
      obs[21 + j] = qvel[6 + j] * DOF_VEL_SCALE;
      obs[33 + j] = act[j];
    }
    obs[45] = Math.sin(2 * Math.PI * ph); obs[46] = Math.cos(2 * Math.PI * ph);
    const a = this.policy.run(obs);
    for (let j = 0; j < 12; j++) { act[j] = a[j]; this.tgt[j] = a[j] * ACTION_SCALE + DEFAULT_ANGLES[j]; }
  }

  private navigate() {
    const c = this.cmd;
    if (this.status !== 'running' && (this.status === 'fell' || this.stopAtGoal)) { c.vx = 0; c.vy = 0; c.yaw = 0; return; }
    if (this.mode === 'manual') { c.vx = this.manualCmd.vx; c.vy = this.manualCmd.vy; c.yaw = this.manualCmd.yaw; return; }
    const p = this.robotPose();
    if (this.mode === 'blind') { blindCommand(p.x, p.y, p.yaw, this.goal.x, this.goal.y, this.nav.speed, c); return; }
    const t = this.time;
    const hasMovers = this.entities.some((e) => e.mover);
    if (t >= this.nextReplan || !this.plan || !this.grid) {
      this.replan(p);
      this.nextReplan = t + (hasMovers ? 0.5 : 1.0);
    } else if (hasMovers && this.plan && this.grid) {
      // cheap check on the existing grid is meaningless for movers; replan schedule handles them
    }
    const dist = Math.hypot(this.goal.x - p.x, this.goal.y - p.y);
    if (!this.plan) { this.yielding = false; blindCommand(p.x, p.y, p.yaw, this.goal.x, this.goal.y, this.nav.speed, c); return; }
    pursuitCommand(p.x, p.y, p.yaw, this.plan, this.nav.speed, this.nav.lookahead, dist, c);
    // someone is about to cross the path: stand and let them pass (turning on the spot is still allowed)
    this.yielding = hasMovers && this.walkerConflict(p);
    if (this.yielding) { c.vx = 0; c.vy = 0; }
  }

  /** Footprint polygons (world xy) of every entity part that a walking robot could hit. */
  footprints(staticOnly = false): number[][] {
    const d = this.data!;
    const xpos = d.xpos as Float64Array, xmat = d.xmat as Float64Array;
    const polys: number[][] = [];
    for (const e of this.entities) {
      if (e.bodyId < 0 || (staticOnly && e.mover)) continue;
      const b = e.bodyId, P = 3 * b, R = 9 * b;
      for (const part of e.parts) {
        const xy: number[] = [];
        let zmax = -Infinity, zmin = Infinity;
        const v = part.verts;
        for (let i = 0; i < v.length; i += 3) {
          const lx = v[i], ly = v[i + 1], lz = v[i + 2];
          const wz = xpos[P + 2] + xmat[R + 6] * lx + xmat[R + 7] * ly + xmat[R + 8] * lz;
          zmax = Math.max(zmax, wz); zmin = Math.min(zmin, wz);
          if (wz > 1.6) continue;
          xy.push(xpos[P] + xmat[R] * lx + xmat[R + 1] * ly + xmat[R + 2] * lz, xpos[P + 1] + xmat[R + 3] * lx + xmat[R + 4] * ly + xmat[R + 5] * lz);
        }
        if (zmax < 0.01 || zmin > 1.6 || xy.length < 2) continue;
        polys.push(hull2d(xy));
      }
    }
    return polys;
  }

  /**
   * Speed control along the planned path (path-velocity decomposition): walks the next stretch of the plan at
   * the robot's speed and checks whether a walker will be at any of those points at about the same moment.
   * The path itself only avoids static objects, so it stays steady; walkers make the robot wait, not swerve.
   */
  private walkerConflict(p: Pose2): boolean {
    const plan = this.plan;
    if (!plan || plan.length < 4) return false;
    const walkers = this.entities.filter((e) => e.mover && e.mover.path.length);
    if (!walkers.length) return false;
    const v = Math.max(0.2, this.nav.speed), t0 = this.time;
    // nearest plan vertex
    let k = 0, best = Infinity;
    for (let i = 0; i < plan.length; i += 2) { const d = Math.hypot(plan[i] - p.x, plan[i + 1] - p.y); if (d < best) { best = d; k = i; } }
    let px = p.x, py = p.y, s = 0;
    const AHEAD = 1.6, STEP = 0.1, CLEAR = 0.45;
    // a walker about to pass where the robot stands: stopping in their lane is worse than clearing it, so that
    // walker is ignored (the robot keeps going); other walkers still count
    const inLane = new Set<Entity>();
    for (const e of walkers) {
      const r = Math.max(0.2, e.radius) + CLEAR;
      for (let dt = 0; dt <= 3.0; dt += 0.2) {
        const q = samplePath(e.mover!.path, t0 + dt, e.mover!.loop !== false);
        if (Math.hypot(q.x - p.x, q.y - p.y) < r) { inLane.add(e); break; }
      }
    }
    for (let i = k; i + 1 < plan.length && s < AHEAD; i += 2) {
      const ax = i === k ? px : plan[i], ay = i === k ? py : plan[i + 1];
      const bx = plan[i + 2] ?? plan[i], by = plan[i + 3] ?? plan[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      for (let u = 0; u < L && s < AHEAD; u += STEP, s += STEP) {
        if (s < 0.35) continue; // already in the lane: keep going and clear it
        const x = ax + ((bx - ax) * u) / L, y = ay + ((by - ay) * u) / L;
        const tau = s / v;
        for (const e of walkers) {
          if (inLane.has(e)) continue;
          const r = Math.max(0.2, e.radius) + CLEAR;
          for (let dt = -1.0; dt <= 1.2; dt += 0.2) {
            if (tau + dt < 0) continue;
            const q = samplePath(e.mover!.path, t0 + tau + dt, e.mover!.loop !== false);
            if (Math.hypot(q.x - x, q.y - y) < r) return true;
          }
        }
      }
      px = bx; py = by;
    }
    return false;
  }

  private replan(p: Pose2) {
    const polys = this.footprints(true);
    let x0 = Math.min(p.x, this.goal.x) - 1.5, x1 = Math.max(p.x, this.goal.x) + 1.5;
    let y0 = Math.min(p.y, this.goal.y) - 1.5, y1 = Math.max(p.y, this.goal.y) + 1.5;
    for (const poly of polys) for (let k = 0; k < poly.length; k += 2) {
      x0 = Math.min(x0, poly[k] - 1); x1 = Math.max(x1, poly[k] + 1);
      y0 = Math.min(y0, poly[k + 1] - 1); y1 = Math.max(y1, poly[k + 1] + 1);
    }
    const L = 25;
    x0 = Math.max(x0, p.x - L); x1 = Math.min(x1, p.x + L); y0 = Math.max(y0, p.y - L); y1 = Math.min(y1, p.y + L);
    this.grid = buildGrid(polys, [x0, y0, x1, y1], this.nav);
    this.plan = planPath(this.grid, p.x, p.y, this.goal.x, this.goal.y);
  }

  /** True when the current plan crosses blocked cells (for UI hints). */
  planBlocked() { return !!(this.grid && this.plan && pathBlocked(this.grid, this.plan, 2)); }

  /** Scans contacts between the robot and entities. Returns true if WASM memory may have moved. */
  private scanContacts(): boolean {
    if (!this.entities.length) return false;
    const d = this.data!, mj = this.mujoco;
    const q = d.qpos as Float64Array, xpos = d.xpos as Float64Array;
    let near = false;
    for (const e of this.entities) {
      if (e.bodyId < 0) continue;
      const dx = xpos[3 * e.bodyId] - q[0], dy = xpos[3 * e.bodyId + 1] - q[1];
      if (Math.hypot(dx, dy) < e.radius + 1.2) { near = true; break; }
    }
    const t = this.time;
    if (near && d.ncon > 0) {
      const cv = d.contact;
      const n = cv.size();
      this.forceBuf ??= new mj.DoubleBuffer(6) as unknown as { GetView(): Float64Array; delete(): void };
      for (let i = 0; i < n; i++) {
        const c = cv.get(i);
        if (!c) continue;
        const g1 = c.geom1, g2 = c.geom2;
        c.delete();
        const o1 = this.geomOwner[g1], o2 = this.geomOwner[g2];
        let ent = -1, rg = -1;
        if (o1 === -2 && o2 >= 0) { ent = o2; rg = g1; } else if (o2 === -2 && o1 >= 0) { ent = o1; rg = g2; }
        if (ent < 0) continue;
        mj.mj_contactForce(this.model!, d, i, this.forceBuf);
        const fn = Math.abs(this.forceBuf.GetView()[0]);
        let tc = this.touching.get(ent);
        if (!tc) {
          const e = this.entities[ent];
          const body = mj.mj_id2name(this.model!, mj.mjtObj.mjOBJ_BODY.value, (this.model!.geom_bodyid as Int32Array)[rg]);
          const ev: ContactEvent = { t, entityId: e.id, entityName: e.name, kind: e.kind, peakForce: 0, impulse: 0, robotBody: body };
          tc = { ev, last: t };
          this.touching.set(ent, tc);
          this.contacts.push(ev);
          this.newContacts.push(ev);
        }
        tc.ev.peakForce = Math.max(tc.ev.peakForce, fn);
        tc.ev.impulse += fn * DT * DECIMATION;
        tc.last = t;
      }
      cv.delete();
    }
    for (const [k, tc] of this.touching) if (t - tc.last > 0.2) this.touching.delete(k);
    return near;
  }

  /**
   * Writes header + poses into buf (length >= layout.length). Poses are x y z qw qx qy qz, MuJoCo world (Z up).
   * Robot entries are the visual geoms (body pose composed with the geom offset from the MJCF).
   */
  writeFrame(buf: Float32Array) {
    const d = this.data!;
    const xpos = d.xpos as Float64Array, xquat = d.xquat as Float64Array, xmat = d.xmat as Float64Array;
    const q = d.qpos as Float64Array;
    const p = this.robotPose();
    buf[H_TIME] = this.time;
    buf[H_STATUS] = STATUS_CODE[this.status];
    buf[H_FALLEN] = this.status === 'fell' ? 1 : 0;
    buf[H_GOAL_REACHED] = this.status === 'goal' ? 1 : 0;
    buf[H_PELVIS_X] = q[0]; buf[H_PELVIS_Y] = q[1]; buf[H_PELVIS_Z] = q[2];
    buf[H_ROBOT_YAW] = p.yaw;
    buf[H_VX] = this.cmd.vx; buf[H_VY] = this.cmd.vy; buf[H_YAW] = this.cmd.yaw;
    buf[H_GOAL_X] = this.goal.x; buf[H_GOAL_Y] = this.goal.y;
    buf[H_SEQ] = ++this.seq;
    buf[H_CONTACTS] = this.contacts.length;
    const last = this.contacts[this.contacts.length - 1];
    buf[H_LAST_CONTACT] = last ? this.entities.findIndex((e) => e.id === last.entityId && e.kind === last.kind) : -1;
    buf[H_LAST_CONTACT_T] = last ? last.t : -1;
    buf[H_FELL_AT] = this.fellAt ?? -1;
    buf[H_GOAL_AT] = this.goalAt ?? -1;
    buf[H_RESERVED] = this.yielding && this.status === 'running' ? 1 : 0; // planner waiting for a walker
    let o = HEADER;
    const vis = this.robotVisuals, vb = this.visBody;
    for (let i = 0; i < vis.length; i++) {
      const b = vb[i], v = vis[i], P = 3 * b, R = 9 * b, Q = 4 * b;
      const lx = v.pos[0], ly = v.pos[1], lz = v.pos[2];
      buf[o] = xpos[P] + xmat[R] * lx + xmat[R + 1] * ly + xmat[R + 2] * lz;
      buf[o + 1] = xpos[P + 1] + xmat[R + 3] * lx + xmat[R + 4] * ly + xmat[R + 5] * lz;
      buf[o + 2] = xpos[P + 2] + xmat[R + 6] * lx + xmat[R + 7] * ly + xmat[R + 8] * lz;
      const aw = xquat[Q], ax = xquat[Q + 1], ay = xquat[Q + 2], az = xquat[Q + 3];
      const bw = v.quat[0], bx = v.quat[1], by = v.quat[2], bz = v.quat[3];
      buf[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
      buf[o + 4] = aw * bx + ax * bw + ay * bz - az * by;
      buf[o + 5] = aw * by - ax * bz + ay * bw + az * bx;
      buf[o + 6] = aw * bz + ax * by - ay * bx + az * bw;
      o += 7;
    }
    const put = (e: Entity) => {
      if (e.bodyId < 0) {
        const qu = yawQuat(e.pose.yaw);
        buf[o] = e.pose.x; buf[o + 1] = e.pose.y; buf[o + 2] = e.pose.z;
        buf[o + 3] = qu[0]; buf[o + 4] = qu[1]; buf[o + 5] = qu[2]; buf[o + 6] = qu[3];
      } else {
        const b = e.bodyId;
        buf[o] = xpos[3 * b]; buf[o + 1] = xpos[3 * b + 1]; buf[o + 2] = xpos[3 * b + 2];
        buf[o + 3] = xquat[4 * b]; buf[o + 4] = xquat[4 * b + 1]; buf[o + 5] = xquat[4 * b + 2]; buf[o + 6] = xquat[4 * b + 3];
      }
      o += 7;
    };
    for (const e of this.entities) if (e.kind === 'object') put(e);
    for (const e of this.entities) if (e.kind === 'mover') put(e);
    for (const e of this.entities) if (e.kind === 'object') for (const h of e.hinges ?? []) if (h.qadr >= 0) buf[o++] = q[h.qadr];
    return buf;
  }

  /** Per-entity facts: mass, hull volume, part count. */
  entityInfo() {
    return this.entities.map((e) => ({ id: e.id, name: e.name, kind: e.kind, fixed: e.fixed, mass: e.mass, volume: e.volume, parts: e.parts.length }));
  }

  /**
   * Sets up trial `index` of `o` on the current model: seeded start/joint/object jitter, scheduled pushes,
   * mode, speed and goal. The scene must already be compiled from o.scene (runTrials and the replay do it).
   * Advance it with advanceTrial(); runTrials and the live replay share this path, so they are bit-identical.
   */
  beginTrial(o: TrialOptions, index: number): TrialRun {
    const maxSeconds = o.maxSeconds ?? 20;
    const J = { startPos: 0.1, startYaw: (10 * Math.PI) / 180, objectPos: 0, objectYaw: 0, ...(o.jitter ?? {}) };
    const base = o.scene.start ?? { x: 0, y: 0, yaw: 0 };
    const seed = mixSeed(o.seed, index);
    const rng = new Rng(seed);
    const start = { x: base.x + rng.uniform(-J.startPos, J.startPos), y: base.y + rng.uniform(-J.startPos, J.startPos), yaw: base.yaw + rng.uniform(-J.startYaw, J.startYaw) };
    const noise = Array.from({ length: 12 }, () => rng.normal(0, 0.01));
    const objectJitter: Record<string, { dx: number; dy: number; dyaw: number }> = {};
    for (const ob of o.scene.objects) objectJitter[ob.id] = { dx: rng.uniform(-J.objectPos, J.objectPos), dy: rng.uniform(-J.objectPos, J.objectPos), dyaw: rng.uniform(-J.objectYaw, J.objectYaw) };
    const pushes: { t: number; force: number; angle: number }[] = [];
    if (o.pushes) {
      const count = o.pushes.count ?? 1;
      for (let k = 0; k < count; k++) pushes.push({ t: rng.uniform(1, Math.max(1.5, maxSeconds - 2)), force: o.pushes.force ?? 120, angle: rng.uniform(0, 2 * Math.PI) });
      pushes.sort((a, b) => a.t - b.t);
    }
    this.goal = { ...(o.scene.goal ?? { x: 4, y: 0 }) };
    this.reset({ start, noise, objectJitter });
    this.mode = o.mode;
    this.nav.speed = o.speed ?? 0.5;
    this.stopAtGoal = true;
    for (const p of pushes) this.schedulePush(Math.round(p.t / DT), p.force, p.angle, o.pushes?.duration ?? 0.2);
    return { options: o, index, seed, start, pushes, total: Math.round(maxSeconds / DT), path: [start.x, start.y], result: null };
  }

  /**
   * Advances a trial by at most maxSteps physics steps (stopping exactly at a fall, the goal or the time limit).
   * Returns the StepInfo of the last chunk; run.result is set once the trial is over.
   */
  advanceTrial(run: TrialRun, maxSteps = Infinity): StepInfo {
    const CHUNK = 250; // 0.5 s => 2 Hz path samples
    let left = maxSteps;
    let info: StepInfo = { t: this.time, status: this.status, fellAt: this.fellAt, goalAt: this.goalAt, newContacts: [], newPushes: [], cmd: { ...this.cmd } };
    const contacts: ContactEvent[] = [], pushes: PushEvent[] = [];
    while (!run.result && left > 0) {
      if (this.robotStep >= run.total || this.status !== 'running') { run.result = this.trialResult(run); break; }
      const k = Math.min(left, CHUNK - (this.robotStep % CHUNK), run.total - this.robotStep);
      info = this.step(k, true);
      contacts.push(...info.newContacts);
      pushes.push(...info.newPushes);
      left -= k;
      if (this.robotStep % CHUNK === 0 && this.status === 'running') { const p = this.robotPose(); run.path.push(p.x, p.y); }
      if (this.robotStep >= run.total || this.status !== 'running' || this.trialStuck(run)) run.result = this.trialResult(run);
    }
    info.newContacts = contacts;
    info.newPushes = pushes;
    return info;
  }

  /**
   * A trial where the robot has stopped moving ends early instead of leaning on an object until the time
   * limit: under 20 cm of net movement over the last 8 s (path samples are 0.5 s apart). Scenes with walkers are
   * exempt, since waiting for someone to pass is progress too. Reported as a timeout at the moment it gave up.
   */
  private trialStuck(run: TrialRun): boolean {
    const WINDOW = 16, path = run.path, n = path.length / 2;
    if (this.status !== 'running' || this.robotStep % 250 !== 0 || n <= WINDOW || this.entities.some((e) => e.mover)) return false;
    // net movement, not progress toward the goal: a planner detour around a long object is not stuck
    const a = n - 1 - WINDOW, b = n - 1;
    return Math.hypot(path[2 * b] - path[2 * a], path[2 * b + 1] - path[2 * a + 1]) < 0.2;
  }

  private trialResult(run: TrialRun): TrialResult {
    const pose = this.robotPose();
    const path = run.path.slice();
    if (path[path.length - 2] !== pose.x || path[path.length - 1] !== pose.y) path.push(pose.x, pose.y);
    const result: TrialResult['result'] = this.status === 'goal' ? 'goal' : this.status === 'fell' ? 'fell' : 'timeout';
    const time = this.status === 'goal' ? this.goalAt! : this.status === 'fell' ? this.fellAt! : this.time;
    const fellAt = this.fellAt;
    const cause = fellAt !== null ? [...this.contacts].reverse().find((c) => c.t <= fellAt + 0.05 && c.t >= fellAt - 1.5) : undefined;
    return {
      index: run.index, seed: run.seed, result, time,
      fallPoint: this.status === 'fell' ? [pose.x, pose.y] : null,
      firstContactObject: this.contacts[0]?.entityId ?? null,
      fallCause: cause?.entityId ?? (fellAt !== null ? this.lastTouchBefore(fellAt) : null),
      contacts: this.contacts.map((c) => ({ ...c })),
      path: Float32Array.from(path), start: run.start, pushes: run.pushes,
    };
  }

  /**
   * Runs n seeded trials of the scene. Deterministic per (scene, options). Compiles the scene once;
   * object jitter is applied to the spawn poses, so no recompiles happen between trials.
   */
  runTrials(o: TrialOptions, onProgress?: (done: number, r: TrialResult) => void): TrialSummary {
    const w0 = now();
    this.setScene(o.scene);
    const savedMode = this.mode, savedSpeed = this.nav.speed, savedGoal = { ...this.goal };
    const trials: TrialResult[] = [];
    let simSeconds = 0;
    for (let i = 0; i < o.n; i++) {
      const run = this.beginTrial(o, i);
      while (!run.result) this.advanceTrial(run);
      simSeconds += this.time;
      trials.push(run.result);
      onProgress?.(i + 1, run.result);
    }
    this.mode = savedMode;
    this.nav.speed = savedSpeed;
    this.goal = savedGoal;
    const goals = trials.filter((t) => t.result === 'goal');
    return {
      trials,
      passRate: o.n ? goals.length / o.n : 0,
      falls: trials.filter((t) => t.result === 'fell').length,
      timeouts: trials.filter((t) => t.result === 'timeout').length,
      meanTimeToGoal: goals.length ? goals.reduce((s, t) => s + t.time, 0) / goals.length : null,
      wallMs: now() - w0,
      simSeconds,
    };
  }

  private lastTouchBefore(t: number): string | null {
    for (let i = this.contacts.length - 1; i >= 0; i--) {
      const c = this.contacts[i];
      const tc = [...this.touching.values()].find((x) => x.ev === c);
      const end = tc ? tc.last : c.t;
      if (c.t <= t && end >= t - 1.5) return c.entityId;
    }
    return null;
  }

  dispose() {
    this.forceBuf?.delete();
    this.data?.delete();
    this.model?.delete();
    this.data = null;
    this.model = null;
  }
}

/** Mover pose at time t (linear interpolation, shortest-angle yaw). */
export function samplePath(path: { x: number; y: number; yaw: number; t: number }[], t: number, loop: boolean) {
  if (path.length === 1) return path[0];
  const T = path[path.length - 1].t;
  let tt = t;
  if (loop && T > 0) tt = path[0].t + ((t - path[0].t) % (T - path[0].t) + (T - path[0].t)) % (T - path[0].t);
  if (tt <= path[0].t) return path[0];
  if (tt >= T) return path[path.length - 1];
  let i = 0;
  while (i + 1 < path.length && path[i + 1].t < tt) i++;
  const a = path[i], b = path[i + 1];
  const u = (tt - a.t) / Math.max(1e-9, b.t - a.t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, yaw: a.yaw + wrap(b.yaw - a.yaw) * u, t: tt };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
