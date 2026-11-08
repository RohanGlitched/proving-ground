// Everything the arena camera draws: the robot, Lux3D objects, the goal flag, the start pad,
// planner paths, fall markers and contact flashes. Physics lives in the sim worker; this class
// only renders frames and turns pointer gestures into placement edits.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Stage } from "./stage";
import { RobotView, mjPos, mjQuat, type RobotVisual } from "./robot";
import { Materializer } from "./materializer";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export type Placement = { uid: string; objectId: string; name: string; x: number; y: number; yaw: number };

const YELLOW = new THREE.Color("#f5c400");
const FAULT = new THREE.Color("#e0362c");
const ROUTE = new THREE.Color("#2b59e8");
const PASS = new THREE.Color("#1e9e5a");

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const glbCache = new Map<string, Promise<THREE.Object3D>>();
const animCache = new Map<string, Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>>();
/** A GLB with its animation clips (walking people). */
export function loadAnimated(url: string) {
  let p = animCache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.frustumCulled = false;
        }
      });
      return { scene: g.scene, animations: g.animations };
    });
    animCache.set(url, p);
  }
  return p;
}
export function loadVisual(url: string) {
  let p = glbCache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      return g.scene;
    });
    glbCache.set(url, p);
  }
  return p;
}

/** MuJoCo world (x,y on the floor) -> three floor point */
const floorPoint = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

function goalFlag() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 10), new THREE.MeshStandardMaterial({ color: 0x141517 }));
  pole.position.y = 0.55;
  g.add(pole);
  // the calibration target as the flag face
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#F5C400";
  x.beginPath();
  x.arc(128, 128, 124, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#141517";
  x.beginPath();
  x.moveTo(128, 128);
  x.arc(128, 128, 124, -Math.PI / 2, 0);
  x.fill();
  x.beginPath();
  x.moveTo(128, 128);
  x.arc(128, 128, 124, Math.PI / 2, Math.PI);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.16, 40), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  face.position.set(0, 0.95, 0);
  g.add(face);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.4, 64),
    new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  g.add(ring);
  g.userData.face = face;
  return g;
}

function startPad() {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.32, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.003;
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.16, 3),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
  );
  arrow.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
  arrow.position.set(0.42, 0.004, 0);
  g.add(pad, arrow);
  return g;
}

type ObjEntry = {
  placement: Placement;
  root: THREE.Group; // positioned by sim poses (or by placement while editing)
  inner: THREE.Group; // GLB, rotated Y-up -> body frame
  mat: Materializer | null;
  hulls: THREE.Group | null;
  flash: number;
};

export class ArenaView {
  readonly stage: Stage;
  robot: RobotView | null = null;
  private objects = new Map<string, ObjEntry>();
  private order: string[] = []; // object uids in sim scene order
  private moverOrder: string[] = [];
  private movers = new Map<string, { root: THREE.Group; mixer: THREE.AnimationMixer | null; lift: number }>();
  private goal = goalFlag();
  private start = startPad();
  private pathLine: THREE.Object3D | null = null;
  private trails = new THREE.Group();
  private marks = new THREE.Group();
  private selectedRing: THREE.Mesh;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private drag: { kind: "object" | "goal"; uid?: string; offset: THREE.Vector3 } | null = null;
  selected: string | null = null;
  showHulls = false;
  follow = true;
  onSelect?: (uid: string | null) => void;
  onMove?: (uid: string, x: number, y: number) => void;
  onGoal?: (x: number, y: number) => void;
  private lastPelvis = new THREE.Vector3();
  private robotFlash = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage({ canvas, dark: true });
    this.stage.camera.position.set(-2.2, 2.6, 4.2);
    this.stage.controls?.target.set(1.6, 0.5, 0);
    if (this.stage.camera.aspect < 1) {
      // portrait phones: look down the course from further back so start, objects and flag all fit
      this.stage.camera.position.set(-1.4, 5.2, 4.6);
      this.stage.controls?.target.set(2.0, 0.2, 0);
    } else if (this.stage.camera.aspect < 1.45) {
      // narrow desktop windows (~1024 px with both rails): pull back so the start pad stays in frame
      this.stage.camera.position.set(-2.6, 3.4, 5.6);
      this.stage.controls?.target.set(1.9, 0.4, 0);
    }
    this.stage.scene.add(this.goal, this.start, this.trails, this.marks);
    this.selectedRing = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.54, 64),
      new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.selectedRing.rotation.x = -Math.PI / 2;
    this.selectedRing.visible = false;
    this.stage.scene.add(this.selectedRing);
    this.bindPointer(canvas);
    this.stage.onFrame((dt) => this.tick(dt));
    this.stage.start();
  }

  setRobot(visuals: RobotVisual[]) {
    if (this.robot) this.stage.scene.remove(this.robot.group);
    this.robot = new RobotView(visuals);
    this.stage.scene.add(this.robot.group);
    return this.robot.ready;
  }

  setGoal(x: number, y: number) {
    this.goal.position.copy(floorPoint(x, y));
  }
  setStart(x: number, y: number, yaw: number) {
    this.start.position.copy(floorPoint(x, y));
    this.start.rotation.y = yaw;
  }

  /** Add or update an object. New objects materialize unless `instant`. */
  async upsertObject(p: Placement, visualUrl: string, opts: { instant?: boolean } = {}) {
    const existing = this.objects.get(p.uid);
    if (existing) {
      existing.placement = p;
      this.placeFromPlacement(existing);
      return;
    }
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.x = 0; // visual GLB is Y-up, same as three; body frame handled in applyFrame
    root.add(inner);
    root.userData.uid = p.uid;
    this.stage.scene.add(root);
    const entry: ObjEntry = { placement: p, root, inner, mat: null, hulls: null, flash: 0 };
    this.objects.set(p.uid, entry);
    this.placeFromPlacement(entry);
    const scene = await loadVisual(visualUrl);
    if (!this.objects.has(p.uid)) return; // removed while loading
    const mat = new Materializer(scene, { maxPoints: 4000 });
    if (opts.instant) mat.finish();
    mat.setHullView(this.showHulls);
    entry.mat = mat;
    inner.add(mat.group);
    entry.hulls = this.makeHulls(mat);
    this.placeFromPlacement(entry);
  }

  private makeHulls(mat: Materializer) {
    // reuse the materializer's hull shells as the "physics view"
    return mat.group;
  }

  removeObject(uid: string) {
    const e = this.objects.get(uid);
    if (!e) return;
    this.stage.scene.remove(e.root);
    e.mat?.dispose();
    this.objects.delete(uid);
    if (this.selected === uid) this.select(null);
  }

  clearObjects() {
    for (const uid of [...this.objects.keys()]) this.removeObject(uid);
  }

  /** scene order the sim uses for object poses */
  setOrder(uids: string[], movers: string[] = []) {
    this.order = uids;
    this.moverOrder = movers;
  }

  /** A walking person (Lux3D rig + retargeted Walk_Loop) driven along a path by the sim. */
  async upsertMover(uid: string, url: string) {
    if (this.movers.has(uid)) return;
    const root = new THREE.Group();
    root.userData.uid = uid;
    const entry = { root, mixer: null as THREE.AnimationMixer | null, lift: 0 };
    this.movers.set(uid, entry);
    this.stage.scene.add(root);
    const g = await loadAnimated(url);
    if (!this.movers.has(uid)) return;
    const body = cloneSkinned(g.scene);
    const box = new THREE.Box3().setFromObject(body);
    entry.lift = -box.min.y;
    root.add(body);
    if (g.animations.length) {
      entry.mixer = new THREE.AnimationMixer(body);
      const clip = g.animations.find((c) => /walk/i.test(c.name)) ?? g.animations[0];
      entry.mixer.clipAction(clip).play();
    }
  }

  removeMover(uid: string) {
    const m = this.movers.get(uid);
    if (!m) return;
    this.stage.scene.remove(m.root);
    this.movers.delete(uid);
  }

  moverIds() {
    return [...this.movers.keys()];
  }

  private placeFromPlacement(e: ObjEntry) {
    // editing: rest the GLB's lowest point on the floor (the sim does the same when it builds the body)
    e.root.position.copy(floorPoint(e.placement.x, e.placement.y, e.mat ? -e.mat.bbox.min.y : 0));
    e.root.rotation.set(0, e.placement.yaw, 0);
    e.root.quaternion.setFromEuler(e.root.rotation);
  }

  select(uid: string | null) {
    this.selected = uid;
    this.onSelect?.(uid);
  }

  flashContact(uid: string) {
    const e = this.objects.get(uid);
    if (e) e.flash = 1;
    this.robotFlash = 2.5;
  }

  /** Apply a frame from the sim. offsets: robot geoms first, then objects in `order`. */
  applyFrame(buf: Float32Array, header: number, robotGeoms: number) {
    this.robot?.update(buf, header);
    const base = header + robotGeoms * 7;
    const q = new THREE.Quaternion();
    for (let i = 0; i < this.order.length; i++) {
      const e = this.objects.get(this.order[i]);
      if (!e || (this.drag && this.drag.uid === e.placement.uid)) continue;
      const o = base + i * 7;
      // body frame origin: the sim placed the object frame so its lowest point rests on the floor;
      // our visual root sits at floor level with the GLB lifted by -bbox.min, which is the same point.
      mjPos(e.root.position, buf[o], buf[o + 1], buf[o + 2]);
      mjQuat(q, buf[o + 3], buf[o + 4], buf[o + 5], buf[o + 6]);
      // parts were rotated Y-up -> Z-up for the body; undo that for the Y-up GLB
      e.root.quaternion.copy(q).multiply(YUP_TO_ZUP);
    }
    const mbase = base + this.order.length * 7;
    for (let i = 0; i < this.moverOrder.length; i++) {
      const m = this.movers.get(this.moverOrder[i]);
      if (!m) continue;
      const o = mbase + i * 7;
      mjPos(m.root.position, buf[o], buf[o + 1], buf[o + 2]);
      mjQuat(q, buf[o + 3], buf[o + 4], buf[o + 5], buf[o + 6]);
      m.root.quaternion.copy(q).multiply(YUP_TO_ZUP);
    }

  }

  /** Draw the planner's path (MuJoCo xy pairs) as a bright tube on the floor with a dot at each turn. */
  setPath(xy: number[] | null, tone: "route" | "pass" = "route") {
    if (this.pathLine) {
      this.stage.scene.remove(this.pathLine);
      this.pathLine.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      this.pathLine = null;
    }
    if (!xy || xy.length < 4) return;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < xy.length; i += 2) pts.push(floorPoint(xy[i], xy[i + 1], 0.03));
    const g = new THREE.Group();
    const color = tone === "pass" ? PASS : new THREE.Color("#5b86ff");
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = a.distanceTo(b);
      if (len < 1e-3) continue;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 10), mat);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(seg);
    }
    const dot = new THREE.SphereGeometry(0.045, 14, 10);
    for (const p of pts) {
      const d = new THREE.Mesh(dot, mat);
      d.position.copy(p);
      g.add(d);
    }
    g.renderOrder = 2;
    this.pathLine = g;
    this.stage.scene.add(g);
  }

  /** Trial trails and fall crosses from a batch of trials. */
  showTrials(trials: { path: Float32Array | number[]; result: string; fallPoint: [number, number] | null }[]) {
    this.clearTrials();
    for (const t of trials) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < t.path.length; i += 2) pts.push(floorPoint(t.path[i], t.path[i + 1], 0.008));
      if (pts.length > 1) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: t.result === "goal" ? PASS : t.result === "fell" ? FAULT : 0x9a9a9a, transparent: true, opacity: 0.75 }),
        );
        this.trails.add(line);
      }
      if (t.fallPoint) {
        const s = 0.09;
        const g = new THREE.BufferGeometry().setFromPoints([
          floorPoint(t.fallPoint[0] - s, t.fallPoint[1] - s, 0.01),
          floorPoint(t.fallPoint[0] + s, t.fallPoint[1] + s, 0.01),
          floorPoint(t.fallPoint[0] - s, t.fallPoint[1] + s, 0.01),
          floorPoint(t.fallPoint[0] + s, t.fallPoint[1] - s, 0.01),
        ]);
        this.marks.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: FAULT })));
      }
    }
  }

  clearTrials() {
    for (const g of [this.trails, this.marks]) {
      for (const c of [...g.children]) {
        g.remove(c);
        (c as THREE.Line).geometry.dispose();
      }
    }
  }

  private pushArrows: { obj: THREE.Object3D; life: number }[] = [];
  /** a red arrow at the robot's pelvis showing a shove (angle: MuJoCo world radians from +X toward +Y) */
  showPush(pelvis: [number, number, number], angle: number, force: number) {
    const dir = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const len = 0.35 + Math.min(0.5, force / 600);
    const origin = new THREE.Vector3(pelvis[0], pelvis[2], -pelvis[1]).sub(dir.clone().multiplyScalar(len + 0.15));
    const arrow = new THREE.ArrowHelper(dir, origin, len, 0xe0362c, 0.14, 0.09);
    (arrow.line.material as THREE.LineBasicMaterial).linewidth = 3;
    this.stage.scene.add(arrow);
    this.pushArrows.push({ obj: arrow, life: 1.4 });
  }

  setShowHulls(v: boolean) {
    this.showHulls = v;
    for (const e of this.objects.values()) e.mat?.setHullView(v);
  }

  private tick(dt: number) {
    for (const m of this.movers.values()) m.mixer?.update(dt);
    for (const a of this.pushArrows) {
      a.life -= dt;
      a.obj.visible = a.life > 0;
    }
    for (const a of this.pushArrows.filter((x) => x.life <= 0)) this.stage.scene.remove(a.obj);
    this.pushArrows = this.pushArrows.filter((x) => x.life > 0);
    for (const e of this.objects.values()) {
      if (e.mat && !e.mat.done) e.mat.update(dt);
      if (e.flash > 0) {
        e.flash = Math.max(0, e.flash - dt * 1.6);
      }
    }
    this.robotFlash = Math.max(0, this.robotFlash - dt * 2.5);
    this.robot?.pulse(this.robotFlash);
    // selection ring
    const sel = this.selected ? this.objects.get(this.selected) : null;
    this.selectedRing.visible = !!sel;
    if (sel) {
      this.selectedRing.position.set(sel.root.position.x, 0.005, sel.root.position.z);
      const r = sel.mat ? Math.max(sel.mat.size.x, sel.mat.size.z) * 0.6 + 0.08 : 0.5;
      this.selectedRing.scale.setScalar(r / 0.52);
    }
    (this.goal.userData.face as THREE.Mesh).rotation.y += dt * 0.6;
  }

  // ---- pointer: click to select, drag objects and the goal along the floor ----
  private pick(ev: PointerEvent) {
    const c = this.stage.renderer.domElement;
    const r = c.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.stage.camera);
    return this.ray;
  }

  private floorHit(ev: PointerEvent) {
    const p = new THREE.Vector3();
    return this.pick(ev).ray.intersectPlane(this.plane, p) ? p : null;
  }

  editable = true;

  private bindPointer(canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", (ev) => {
      if (!this.editable || ev.button !== 0) return;
      const ray = this.pick(ev);
      const goalHit = ray.intersectObject(this.goal, true)[0];
      const roots = [...this.objects.values()].map((e) => e.root);
      const hit = ray.intersectObjects(roots, true)[0];
      if (goalHit && (!hit || goalHit.distance < hit.distance)) {
        this.drag = { kind: "goal", offset: new THREE.Vector3() };
      } else if (hit) {
        let o: THREE.Object3D | null = hit.object;
        while (o && !o.userData.uid) o = o.parent;
        const uid = o?.userData.uid as string | undefined;
        if (uid) {
          const e = this.objects.get(uid)!;
          const fp = this.floorHit(ev);
          this.drag = { kind: "object", uid, offset: fp ? e.root.position.clone().sub(fp).setY(0) : new THREE.Vector3() };
          this.select(uid);
        }
      } else {
        this.select(null);
        return;
      }
      if (this.stage.controls) this.stage.controls.enabled = false;
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!this.drag) return;
      const fp = this.floorHit(ev);
      if (!fp) return;
      const p = fp.add(this.drag.offset);
      const x = Math.max(-6, Math.min(10, p.x));
      const y = Math.max(-6, Math.min(6, -p.z));
      if (this.drag.kind === "goal") {
        this.setGoal(x, y);
      } else if (this.drag.uid) {
        const e = this.objects.get(this.drag.uid);
        if (e) {
          e.placement = { ...e.placement, x, y };
          this.placeFromPlacement(e);
        }
      }
    });
    const end = (ev: PointerEvent) => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (this.stage.controls) this.stage.controls.enabled = true;
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {}
      if (d.kind === "goal") this.onGoal?.(this.goal.position.x, -this.goal.position.z);
      else if (d.uid) {
        const e = this.objects.get(d.uid);
        if (e) this.onMove?.(d.uid, e.placement.x, e.placement.y);
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  /** pixels per metre at the goal's distance, for the camera frame's scale bar */
  pxPerMetre() {
    const cam = this.stage.camera;
    const c = this.stage.renderer.domElement;
    const target = this.stage.controls?.target ?? new THREE.Vector3();
    const dist = cam.position.distanceTo(target);
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    return c.clientHeight / h;
  }

  dispose() {
    this.stage.dispose();
  }
}

const YUP_TO_ZUP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
