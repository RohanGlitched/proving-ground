// The materializer: how every Lux3D object enters the world.
// points condense into the object -> a scan line reveals the textured mesh -> the parts pull apart
// (Lux3D part-split) -> each part is wrapped in its convex hull (what the physics engine sees)
// -> the parts close up again and the object is ready to drop.
import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";

export type MaterializePhase = "condense" | "reveal" | "split" | "hulls" | "ready";

export const PHASE_COPY: Record<MaterializePhase, string> = {
  condense: "Lux3D is building the shape",
  reveal: "Texturing at real-world size",
  split: "Part-split pulls it into pieces",
  hulls: "Each piece becomes a solid the physics can feel",
  ready: "Ready to drop",
};

// timeline in seconds
const T = {
  condense: [0, 1.15],
  reveal: [0.85, 1.9],
  split: [1.9, 2.6],
  hulls: [2.35, 3.0],
  hold: [3.0, 3.7],
  close: [3.7, 4.3],
} as const;
export const MATERIALIZE_SECONDS = T.close[1];

const YELLOW = new THREE.Color("#f5c400");
const ROUTE = new THREE.Color("#2b59e8");

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const span = (t: number, [a, b]: readonly [number, number]) => clamp01((t - a) / (b - a));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

type Part = {
  mesh: THREE.Mesh;
  hull: THREE.Mesh | null;
  edges: THREE.LineSegments | null;
  dir: THREE.Vector3;
  center: THREE.Vector3;
  reveal: { value: number };
};

/** Build a revealable copy of a mesh material: a scan line sweeps up through the object. */
function revealMaterial(src: THREE.Material, minY: number, height: number, reveal: { value: number }) {
  const base = (src as THREE.MeshStandardMaterial).isMeshStandardMaterial
    ? (src as THREE.MeshStandardMaterial).clone()
    : new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.8 });
  base.transparent = false;
  base.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal;
    shader.uniforms.uMinY = { value: minY };
    shader.uniforms.uHeight = { value: Math.max(height, 1e-3) };
    shader.uniforms.uEdge = { value: YELLOW };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vScanY;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvScanY = transformed.y;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vScanY;
         uniform float uReveal; uniform float uMinY; uniform float uHeight; uniform vec3 uEdge;
         float pgHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
         float h = (vScanY - uMinY) / uHeight;
         float n = pgHash(floor(gl_FragCoord.xy / 3.0)) * 0.035;
         float edge = uReveal * 1.06 - h - n;
         if (edge < 0.0) discard;
         float band = 1.0 - smoothstep(0.0, 0.05, edge);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdge * 1.6, band * step(uReveal, 0.999));`,
      );
  };
  base.customProgramCacheKey = () => "pg-reveal";
  return base;
}

function pointsMaterial(size: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uP: { value: 0 },
      uFade: { value: 1 },
      uSize: { value: size },
      uColor: { value: YELLOW },
      uPixelRatio: { value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1 },
    },
    vertexShader: `
      attribute vec3 aStart; attribute float aDelay;
      uniform float uP; uniform float uSize; uniform float uPixelRatio;
      varying float vK;
      float ease(float x){ return 1.0 - pow(1.0 - x, 3.0); }
      void main(){
        float k = ease(clamp((uP - aDelay) / (1.0 - aDelay * 0.6), 0.0, 1.0));
        vK = k;
        vec3 p = mix(aStart, position, k);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPixelRatio * (1.0 + (1.0 - k) * 1.5) / -mv.z;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uFade; varying float vK;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.0, d) * uFade * (0.35 + 0.65 * vK);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), vK * 0.35), a);
      }`,
  });
}

export class Materializer {
  readonly group = new THREE.Group();
  readonly size = new THREE.Vector3();
  readonly bbox = new THREE.Box3();
  private parts: Part[] = [];
  private points: THREE.Points;
  private pointsMat: THREE.ShaderMaterial;
  private t = 0;
  private lastPhase: MaterializePhase | null = null;
  onPhase?: (p: MaterializePhase) => void;
  /** how far the parts travel when they split, as a fraction of the object size */
  explode = 0.3;

  /**
   * @param source a loaded GLB scene (one mesh per Lux3D part, metric, Y-up). It is cloned, not mutated.
   */
  constructor(source: THREE.Object3D, opts: { maxPoints?: number; showHulls?: boolean } = {}) {
    const root = source.clone(true);
    root.updateMatrixWorld(true);
    this.bbox.setFromObject(root);
    this.bbox.getSize(this.size);
    const objCenter = this.bbox.getCenter(new THREE.Vector3());
    const minY = this.bbox.min.y;
    const height = this.size.y;

    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    const allPositions: number[] = [];
    for (const m of meshes) {
      const geo = (m.geometry as THREE.BufferGeometry).clone();
      geo.applyMatrix4(m.matrixWorld);
      geo.computeBoundingBox();
      const center = geo.boundingBox!.getCenter(new THREE.Vector3());
      const reveal = { value: 0 };
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const mat = revealMaterial(mats[0], minY, height, reveal);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const dir = center.clone().sub(objCenter);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      dir.y = dir.y * 0.6 + 0.25; // parts lift a little as they part
      dir.normalize();

      // hull: what MuJoCo feels for this part
      let hull: THREE.Mesh | null = null;
      let edges: THREE.LineSegments | null = null;
      if (opts.showHulls !== false) {
        const pos = geo.getAttribute("position") as THREE.BufferAttribute;
        const step = Math.max(1, Math.floor(pos.count / 1500));
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
        if (pts.length >= 4) {
          try {
            const hg = new ConvexGeometry(pts);
            hull = new THREE.Mesh(
              hg,
              new THREE.MeshBasicMaterial({ color: ROUTE, transparent: true, opacity: 0, depthWrite: false }),
            );
            edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(hg, 18),
              new THREE.LineBasicMaterial({ color: ROUTE, transparent: true, opacity: 0 }),
            );
          } catch {
            hull = null;
          }
        }
      }
      this.parts.push({ mesh, hull, edges, dir, center, reveal });
      this.group.add(mesh);
      if (hull) this.group.add(hull);
      if (edges) this.group.add(edges);

      const p = geo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) allPositions.push(p.getX(i), p.getY(i), p.getZ(i));
    }

    // point cloud: a subset of the real vertices, flying in from above
    const maxPoints = opts.maxPoints ?? 7000;
    const total = allPositions.length / 3;
    const n = Math.min(maxPoints, total);
    const target = new Float32Array(n * 3);
    const start = new Float32Array(n * 3);
    const delay = new Float32Array(n);
    const r = Math.max(this.size.x, this.size.y, this.size.z) || 1;
    let seed = 1337;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const src = Math.floor((i / n) * total + rand() * (total / n)) % total;
      target[i * 3] = allPositions[src * 3];
      target[i * 3 + 1] = allPositions[src * 3 + 1];
      target[i * 3 + 2] = allPositions[src * 3 + 2];
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      const rr = r * (0.9 + rand() * 1.4);
      start[i * 3] = objCenter.x + rr * Math.sin(ph) * Math.cos(th);
      start[i * 3 + 1] = objCenter.y + Math.abs(rr * Math.cos(ph)) + r * 0.6;
      start[i * 3 + 2] = objCenter.z + rr * Math.sin(ph) * Math.sin(th);
      // lower points arrive first: the shape builds bottom-up
      const h = (target[i * 3 + 1] - minY) / (height || 1);
      delay[i] = clamp01(h * 0.45 + rand() * 0.15);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(target, 3));
    pg.setAttribute("aStart", new THREE.BufferAttribute(start, 3));
    pg.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
    this.pointsMat = pointsMaterial(Math.max(2.2, r * 3.2));
    this.points = new THREE.Points(pg, this.pointsMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.apply(0);
  }

  get partCount() {
    return this.parts.length;
  }

  /** world-space centre of part i at the current time (for HTML labels) */
  partAnchor(i: number, out = new THREE.Vector3()) {
    const p = this.parts[i];
    return out.copy(p.center).add(p.mesh.position).applyMatrix4(this.group.matrixWorld);
  }

  /** Physics view: keep every part's convex hull visible over the finished object. */
  hullView = false;
  setHullView(v: boolean) {
    this.hullView = v;
    if (this.done) this.apply(this.t);
  }

  get done() {
    return this.t >= MATERIALIZE_SECONDS;
  }

  reset() {
    this.t = 0;
    this.lastPhase = null;
    this.apply(0);
  }

  /** jump to the end state (reduced motion) */
  finish() {
    this.t = MATERIALIZE_SECONDS;
    this.apply(this.t);
  }

  /** scrub to an absolute time (scroll-driven views) */
  seek(t: number) {
    this.t = Math.max(0, Math.min(MATERIALIZE_SECONDS, t));
    this.apply(this.t);
  }

  update(dt: number) {
    if (this.t >= MATERIALIZE_SECONDS) return true;
    this.t = Math.min(MATERIALIZE_SECONDS, this.t + dt);
    this.apply(this.t);
    return this.done;
  }

  private phaseAt(t: number): MaterializePhase {
    if (t < T.reveal[0] + 0.25) return "condense";
    if (t < T.split[0]) return "reveal";
    if (t < T.hulls[0] + 0.1) return "split";
    if (t < T.close[0]) return "hulls";
    return "ready";
  }

  private apply(t: number) {
    const ph = this.phaseAt(t);
    if (ph !== this.lastPhase) {
      this.lastPhase = ph;
      this.onPhase?.(ph);
    }
    // points
    const pc = span(t, T.condense);
    this.pointsMat.uniforms.uP.value = pc;
    this.pointsMat.uniforms.uFade.value = 1 - span(t, [T.reveal[0] + 0.3, T.reveal[1]]);
    this.points.visible = t < T.reveal[1];

    // reveal
    const rv = easeInOut(span(t, T.reveal));
    // explode out, then close
    const out = easeInOut(span(t, T.split)) * (1 - easeInOut(span(t, T.close)));
    let hullIn = easeOut(span(t, T.hulls)) * (1 - easeOut(span(t, [T.close[0], T.close[0] + 0.35])));
    if (this.hullView && t >= MATERIALIZE_SECONDS) hullIn = 1;
    const multi = this.parts.length > 1;
    const dist = Math.max(this.size.x, this.size.y, this.size.z) * this.explode * (multi ? 1 : 0.25);
    for (const p of this.parts) {
      p.reveal.value = rv;
      p.mesh.visible = rv > 0.001;
      p.mesh.position.copy(p.dir).multiplyScalar(dist * out);
      if (p.hull && p.edges) {
        p.hull.position.copy(p.mesh.position);
        p.edges.position.copy(p.mesh.position);
        (p.hull.material as THREE.MeshBasicMaterial).opacity = (this.hullView && t >= MATERIALIZE_SECONDS ? 0.3 : 0.16) * hullIn;
        (p.edges.material as THREE.LineBasicMaterial).opacity = 0.9 * hullIn;
        p.hull.visible = p.edges.visible = hullIn > 0.001;
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
