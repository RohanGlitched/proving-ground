import { Document, Logger, NodeIO, type Node as GNode, type mat4 } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { clearNodeParent, clearNodeTransform, dedup, getBounds, mergeDocuments, meshopt, prune, simplify, textureCompress, unpartition, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { Vector3 } from "three";
import { unzipSync } from "three/examples/jsm/libs/fflate.module.js";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";

/**
 * Turns Lux3D GLBs into what the app loads:
 *
 * (a) visual.glb: one mesh node per part, named part-0, part-1, … in the same order as parts.json (the UI
 *     explodes the parts and wraps each in its physics hull, so visual part i is physics part i). Node
 *     transforms are baked into the geometry and every part sits at the scene root. Welded, simplified to at
 *     most 25k triangles in total, textures resized to ≤1024 px and converted to WebP (EXT_texture_webp),
 *     and meshopt-compressed (EXT_meshopt_compression + KHR_mesh_quantization) for static objects. three.js
 *     needs `loader.setMeshoptDecoder(MeshoptDecoder)` from three/examples/jsm/libs/meshopt_decoder.module.js.
 *     Animated models (rigged pedestrians, articulated objects) keep their hierarchy and animations and skip
 *     meshopt quantization.
 * (b) parts.json for physics: per part a point cloud of at most 400 extreme points (the sim hulls it).
 *
 * Coordinates: Lux3D output is metric and Y-up, centred on the bounding-box centre; both files keep that
 * frame unchanged (`up: "y"`, `unit: "m"`). Note that lux3d_metadata.bbox lists the extents in Z-up order,
 * so the bbox recorded here is measured from the geometry instead.
 */

export const LIMITS = { maxTris: 25_000, maxPartPoints: 400, targetBytes: 1_500_000, maxTexture: 1024 };

export type BBox = { min: [number, number, number]; max: [number, number, number] };
export type VolumeMethod = "mesh" | "mesh-share" | "hull";
/**
 * volume (m³): "mesh" = enclosed by the part's own closed surface; "mesh-share" = the closed whole-object
 * mesh's volume shared out by hull volume (part-split leaves the cut faces open); "hull" = 0.6 × hull.
 */
export type Part = { name: string; count: number; points: number[]; bbox: BBox; centroid: [number, number, number]; volume: number; volumeMethod: VolumeMethod; hullVolume: number };
export type PartsDoc = {
  version: 1;
  up: "y";
  unit: "m";
  frame: string;
  source: "part-split" | "whole";
  bbox: BBox;
  /** Sum of the part volumes (m³); mass = volume × density. */
  volume: number;
  parts: Part[];
  animated?: { clips: { name: string; duration: number }[]; inPlace?: boolean };
  /** Articulated objects: joints between parts (indices into parts), in the same object frame. */
  joints?: Joint[];
};

/**
 * One URDF joint. Rotate part `child` by angle θ ∈ [lower, upper] (radians) about the line through `pivot`
 * along `axis`; a prismatic joint slides along `axis` by [lower, upper] metres.
 */
export type Joint = {
  name: string;
  type: string;
  parent: number;
  child: number;
  pivot: [number, number, number];
  axis: [number, number, number];
  lower: number;
  upper: number;
};

export type ProcessStats = {
  /** Uniform scale applied by the size check (1 = untouched). */
  fitScale?: number;
  inputBytes: number;
  visualBytes: number;
  partsBytes: number;
  trisIn: number;
  tris: number;
  parts: number;
  texture: number;
  ms: number;
};

export type ProcessResult = { visual: Buffer; parts: PartsDoc; partsJson: string; stats: ProcessStats; lux3dMetadata?: unknown };

let ioPromise: Promise<NodeIO> | null = null;
export function gltfIO(): Promise<NodeIO> {
  ioPromise ??= (async () => {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
    return new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  })();
  return ioPromise;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function meshNodes(doc: Document): GNode[] {
  const out: GNode[] = [];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return out;
  const walk = (n: GNode) => {
    if (n.getMesh()) out.push(n);
    n.listChildren().forEach(walk);
  };
  scene.listChildren().forEach(walk);
  return out;
}

export function triangleCount(doc: Document): number {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const n = idx ? idx.getCount() : (p.getAttribute("POSITION")?.getCount() ?? 0);
      if (p.getMode() === 4) t += Math.floor(n / 3);
    }
  return t;
}

/** World-space positions of one mesh node (node transform applied). */
function nodePositions(node: GNode): Float64Array {
  const m = node.getWorldMatrix() as unknown as number[];
  const arrays: number[][] = [];
  let total = 0;
  for (const p of node.getMesh()!.listPrimitives()) {
    const a = p.getAttribute("POSITION");
    if (!a) continue;
    const el = [0, 0, 0];
    const pts: number[] = [];
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, el);
      const [x, y, z] = el;
      pts.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
    }
    arrays.push(pts);
    total += pts.length;
  }
  const out = new Float64Array(total);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function bboxOf(p: ArrayLike<number>): BBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  return { min: min.map(r4) as BBox["min"], max: max.map(r4) as BBox["max"] };
}

function uniquePoints(p: ArrayLike<number>): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = r4(p[i]),
      y = r4(p[i + 1]),
      z = r4(p[i + 2]);
    const k = `${x},${y},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x, y, z);
  }
  return out;
}

/**
 * At most `max` points that keep the convex hull: the extreme point along each of ~3·max directions on a
 * Fibonacci sphere (each is a hull vertex), thinned by farthest-point sampling when there are still too many.
 */
export function decimateForHull(points: number[], max = LIMITS.maxPartPoints): number[] {
  const n = points.length / 3;
  if (n <= max) return points;
  const dirs = Math.max(64, max * 3);
  const chosen = new Set<number>();
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let d = 0; d < dirs; d++) {
    const y = 1 - (2 * (d + 0.5)) / dirs;
    const r = Math.sqrt(1 - y * y);
    const th = golden * d;
    const dx = Math.cos(th) * r,
      dz = Math.sin(th) * r;
    let best = -Infinity,
      bi = 0;
    for (let i = 0; i < n; i++) {
      const v = points[3 * i] * dx + points[3 * i + 1] * y + points[3 * i + 2] * dz;
      if (v > best) {
        best = v;
        bi = i;
      }
    }
    chosen.add(bi);
  }
  let idx = [...chosen];
  if (idx.length > max) {
    // farthest-point sampling within the extreme set
    const keep = [idx[0]];
    const dist = idx.map(() => Infinity);
    for (let s = 1; s < max; s++) {
      const last = keep[keep.length - 1];
      let bj = -1,
        bd = -1;
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j];
        const ddx = points[3 * i] - points[3 * last],
          ddy = points[3 * i + 1] - points[3 * last + 1],
          ddz = points[3 * i + 2] - points[3 * last + 2];
        const dd = ddx * ddx + ddy * ddy + ddz * ddz;
        if (dd < dist[j]) dist[j] = dd;
        if (dist[j] > bd) {
          bd = dist[j];
          bj = j;
        }
      }
      keep.push(idx[bj]);
    }
    idx = keep;
  }
  const out: number[] = [];
  for (const i of idx) out.push(points[3 * i], points[3 * i + 1], points[3 * i + 2]);
  return out;
}

/** Convex hull volume (m³) of a flat xyz list. */
export function hullVolume(points: number[]): number {
  if (points.length < 12) return 0;
  const vs: Vector3[] = [];
  for (let i = 0; i < points.length; i += 3) vs.push(new Vector3(points[i], points[i + 1], points[i + 2]));
  try {
    const h = new ConvexHull().setFromPoints(vs);
    let v = 0;
    for (const f of h.faces) {
      const loop: Vector3[] = [];
      let e = f.edge;
      do {
        loop.push(e.head().point);
        e = e.next;
      } while (e !== f.edge);
      for (let i = 1; i + 1 < loop.length; i++) v += loop[0].dot(new Vector3().crossVectors(loop[i], loop[i + 1])) / 6;
    }
    return Math.abs(v);
  } catch {
    return 0;
  }
}

/**
 * Volume (m³) enclosed by a node's triangles via signed tetrahedra, and whether the surface is closed:
 * vertices are welded by position (UV seams split them), then at most 0.5% of edges may be open.
 */
export function meshVolume(node: GNode): { volume: number; closed: boolean } {
  const m = node.getWorldMatrix() as unknown as number[];
  const ids = new Map<string, number>();
  const P: number[] = [];
  const edges = new Map<string, number>();
  let vol = 0;
  let tris = 0;
  const el = [0, 0, 0];
  for (const prim of node.getMesh()!.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    const remap = new Int32Array(pos.getCount());
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      const [x, y, z] = el;
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12],
        wy = m[1] * x + m[5] * y + m[9] * z + m[13],
        wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const k = `${Math.round(wx * 1e5)},${Math.round(wy * 1e5)},${Math.round(wz * 1e5)}`;
      let id = ids.get(k);
      if (id === undefined) {
        id = P.length / 3;
        ids.set(k, id);
        P.push(wx, wy, wz);
      }
      remap[i] = id;
    }
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    for (let t = 0; t + 2 < n; t += 3) {
      const a = remap[idx ? idx.getScalar(t) : t],
        b = remap[idx ? idx.getScalar(t + 1) : t + 1],
        c = remap[idx ? idx.getScalar(t + 2) : t + 2];
      if (a === b || b === c || a === c) continue;
      tris++;
      const ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
      const bx = P[3 * b], by = P[3 * b + 1], bz = P[3 * b + 2];
      const cx = P[3 * c], cy = P[3 * c + 1], cz = P[3 * c + 2];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const k = u < v ? `${u}_${v}` : `${v}_${u}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
  }
  let open = 0;
  for (const c of edges.values()) if (c !== 2) open++;
  const closed = tris > 0 && open <= edges.size * 0.005;
  return { volume: Math.abs(vol), closed };
}

function withVolume(part: Omit<Part, "volume" | "volumeMethod" | "hullVolume">, mesh: { volume: number; closed: boolean }): Part {
  const hv = hullVolume(part.points);
  // a closed mesh can't exceed its own hull; if it seems to, the surface is inverted or self-overlapping
  const meshOk = mesh.closed && mesh.volume > 0 && mesh.volume <= hv * 1.05;
  const volume = meshOk ? mesh.volume : 0.6 * hv;
  return { ...part, volume: +volume.toPrecision(5), volumeMethod: meshOk ? "mesh" : "hull", hullVolume: +hv.toPrecision(5) };
}

function sumMesh(nodes: GNode[]): { volume: number; closed: boolean } {
  const vs = nodes.map(meshVolume);
  return { volume: vs.reduce((s, v) => s + v.volume, 0), closed: vs.every((v) => v.closed) };
}

function partFrom(name: string, raw: Float64Array): Omit<Part, "volume" | "volumeMethod" | "hullVolume"> {
  const uniq = uniquePoints(raw);
  const pts = decimateForHull(uniq);
  const c: [number, number, number] = [0, 0, 0];
  const n = uniq.length / 3;
  for (let i = 0; i < uniq.length; i += 3) {
    c[0] += uniq[i] / n;
    c[1] += uniq[i + 1] / n;
    c[2] += uniq[i + 2] / n;
  }
  return { name, count: pts.length / 3, points: pts, bbox: bboxOf(uniq), centroid: c.map(r4) as Part["centroid"] };
}

/** A part is kept when it has at least 4 distinct points and is at least 2 mm across in two axes. */
function usable(raw: Float64Array): boolean {
  if (raw.length < 12) return false;
  const b = bboxOf(raw);
  const ext = [0, 1, 2].map((k) => b.max[k] - b.min[k]).sort((a, z) => z - a);
  return ext[1] >= 0.002;
}

export type ProcessInput = {
  /** The GLB the visual and parts are built from (part-split result when available, else the whole mesh). */
  glb: Buffer;
  /** true when `glb` is a part-split result (each mesh node is one part). */
  split: boolean;
  /** Animated models keep their hierarchy and skip quantization. */
  animated?: boolean;
  inPlace?: boolean;
  /** Renames a single animation clip (Lux3D names the retargeted walk "animation_1"). */
  clipName?: string;
  /** The unsplit generation GLB; its closed volume is shared out across split parts. */
  wholeGlb?: Buffer;
  /**
   * Typical largest dimension (m) for this kind of object. Lux3D usually gets real size right, but now and
   * then returns a 3.9 m door or a 2.2 m skateboard; when the model is off by more than 35% it is scaled
   * uniformly to this size (static objects only).
   */
  fitMaxDim?: number;
};

export async function processModel(input: ProcessInput): Promise<ProcessResult> {
  const t0 = Date.now();
  const io = await gltfIO();
  const doc = await io.readBinary(new Uint8Array(input.glb));
  const root = doc.getRoot();
  const lux3dMetadata = (root.getExtras() as Record<string, unknown>)?.lux3d_metadata;
  const animated = input.animated || root.listAnimations().length > 0 || root.listSkins().length > 0;
  const trisIn = triangleCount(doc);
  if (input.clipName && root.listAnimations().length === 1) root.listAnimations()[0].setName(input.clipName);

  // 1. parts, in scene order; unusable slivers are removed from both files
  let nodes = meshNodes(doc);
  for (const n of nodes) {
    if (!usable(nodePositions(n))) {
      n.getMesh()?.dispose();
      n.dispose();
    }
  }
  nodes = meshNodes(doc);
  if (nodes.length === 0) throw new Error("The model has no usable geometry.");

  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let partList: Part[];
  let source: PartsDoc["source"];
  let fitScale = 1;
  if (!animated) {
    // bake transforms and move each part to the scene root (meshes are unshared after this)
    for (const n of nodes) {
      const mesh = n.getMesh()!;
      if (mesh.listParents().filter((p) => p.propertyType === "Node").length > 1) n.setMesh(mesh.clone());
      clearNodeParent(n);
      clearNodeTransform(n);
    }
    for (const child of scene.listChildren()) if (!nodes.includes(child)) child.dispose();
    if (input.fitMaxDim) {
      const b0 = getBounds(scene);
      const dim = Math.max(...[0, 1, 2].map((k) => b0.max[k] - b0.min[k]));
      const ratio = dim > 0 ? input.fitMaxDim / dim : 1;
      if (ratio < 1 / 1.35 || ratio > 1.35) {
        fitScale = ratio;
        for (const n of nodes) {
          n.setScale([ratio, ratio, ratio]);
          clearNodeTransform(n);
        }
      }
    }
    nodes.forEach((n, i) => {
      n.setName(`part-${i}`);
      n.getMesh()!.setName(`part-${i}`);
    });
    if (input.split && nodes.length > 1) {
      partList = nodes.map((n, i) => withVolume(partFrom(`part-${i}`, nodePositions(n)), meshVolume(n)));
      if (input.wholeGlb && partList.some((p) => p.volumeMethod === "hull")) {
        const whole = sumMesh(meshNodes(await io.readBinary(new Uint8Array(input.wholeGlb))));
        whole.volume *= fitScale ** 3; // the unsplit mesh was not rescaled by the size check
        const hullSum = partList.reduce((t, p) => t + p.hullVolume, 0);
        if (whole.closed && whole.volume > 0 && hullSum > 0)
          partList = partList.map((p) => ({ ...p, volume: +((whole.volume * p.hullVolume) / hullSum).toPrecision(5), volumeMethod: "mesh-share" as const }));
      }
      source = "part-split";
    } else {
      // single part: one node holds the whole object
      const all = nodes.map(nodePositions);
      const merged = new Float64Array(all.reduce((s, a) => s + a.length, 0));
      let o = 0;
      for (const a of all) {
        merged.set(a, o);
        o += a.length;
      }
      partList = [withVolume(partFrom("part-0", merged), sumMesh(nodes))];
      source = "whole";
      if (nodes.length > 1) {
        // keep the visual consistent with one physics part: group meshes under one node "part-0"
        const group = doc.createNode("part-0");
        scene.addChild(group);
        nodes.forEach((n, i) => {
          n.setName(`part-0-mesh-${i}`);
          group.addChild(n);
        });
      }
    }
  } else {
    const all = nodes.map(nodePositions);
    const merged = new Float64Array(all.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of all) {
      merged.set(a, o);
      o += a.length;
    }
    // a walking person collides as their body without the outstretched arms (rest pose is a T/A-pose)
    const body = input.inPlace ? bodyWithoutArms(merged) : merged;
    partList = [withVolume(partFrom("part-0", body), sumMesh(nodes))];
    source = "whole";
    nodes.forEach((n, i) => n.setName(nodes.length === 1 ? "part-0" : `part-0-mesh-${i}`));
  }

  const b = getBounds(scene);
  const bbox: BBox = { min: b.min.map(r4) as BBox["min"], max: b.max.map(r4) as BBox["max"] };
  root.setExtras({ ...(root.getExtras() as object), provingGround: { up: "y", unit: "m", parts: partList.length } });

  // 2. geometry: weld + simplify to the triangle budget
  await doc.transform(weld());
  let tris = triangleCount(doc);
  if (tris > LIMITS.maxTris) {
    for (const error of [0.002, 0.01, 0.03, 0.08]) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, (LIMITS.maxTris / tris) * 0.97), error, lockBorder: false }));
      tris = triangleCount(doc);
      if (tris <= LIMITS.maxTris) break;
    }
  }
  await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: false }));
  const geometryOnly = await io.writeBinary(doc);

  // 3. textures + compression, stepping down until the size target holds
  let visual: Uint8Array | null = null;
  let texture = 0;
  for (const [size, quality] of [
    [1024, 82],
    [1024, 70],
    [768, 70],
    [512, 68],
  ] as const) {
    const d = await io.readBinary(geometryOnly);
    await d.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [size, size], quality }));
    if (!animated) await d.transform(meshopt({ encoder: MeshoptEncoder, level: "medium", quantizationVolume: "scene" }));
    visual = await io.writeBinary(d);
    texture = size;
    if (visual.byteLength <= LIMITS.targetBytes) break;
  }

  const parts: PartsDoc = {
    version: 1,
    up: "y",
    unit: "m",
    frame: "object frame: Y-up, metres, origin at the Lux3D bounding-box centre (same frame as visual.glb)",
    source,
    bbox,
    volume: +partList.reduce((s, p) => s + p.volume, 0).toPrecision(5),
    parts: partList,
  };
  if (animated) {
    parts.animated = { clips: root.listAnimations().map((a) => ({ name: a.getName(), duration: r4(animationDuration(a)) })), inPlace: input.inPlace };
  }
  const partsJson = JSON.stringify(parts);
  return {
    visual: Buffer.from(visual!),
    parts,
    partsJson,
    lux3dMetadata,
    stats: {
      fitScale,
      inputBytes: input.glb.length,
      visualBytes: visual!.byteLength,
      partsBytes: Buffer.byteLength(partsJson),
      trisIn,
      tris,
      parts: partList.length,
      texture,
      ms: Date.now() - t0,
    },
  };
}

function animationDuration(a: import("@gltf-transform/core").Animation): number {
  let max = 0;
  for (const s of a.listSamplers()) {
    const input = s.getInput();
    if (!input) continue;
    const mm = input.getMax([0]) as number[];
    if (mm[0] > max) max = mm[0];
  }
  return max;
}

/**
 * Rest-pose points of a person minus the arms: the arms stretch along the wider horizontal axis, so keep
 * points within 0.12 × height of the body's centre line on that axis (shoulders to hips stay).
 */
export function bodyWithoutArms(p: Float64Array): Float64Array {
  const b = bboxOf(p);
  const h = b.max[1] - b.min[1];
  const axis = b.max[0] - b.min[0] >= b.max[2] - b.min[2] ? 0 : 2;
  // centre line: median of the axis coordinate over the lower half (legs and hips)
  const lower: number[] = [];
  for (let i = 0; i < p.length; i += 3) if (p[i + 1] < b.min[1] + h * 0.45) lower.push(p[i + axis]);
  lower.sort((x, y) => x - y);
  const c = lower.length ? lower[Math.floor(lower.length / 2)] : (b.min[axis] + b.max[axis]) / 2;
  const half = 0.12 * h;
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + axis] - c) <= half) out.push(p[i], p[i + 1], p[i + 2]);
  return out.length >= 12 ? Float64Array.from(out) : p;
}

/* ───────────────────────── articulation (URDF package) ───────────────────────── */

type UrdfJoint = { name: string; type: string; parent: string; child: string; xyz: number[]; rpy: number[]; axis: number[]; lower: number; upper: number };

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}
const nums = (v: string | undefined, d: number[]) => (v ? v.trim().split(/\s+/).map(Number) : d);

export function parseUrdf(xml: string): { links: { name: string; mesh?: string }[]; joints: UrdfJoint[] } {
  const links = [...xml.matchAll(/<link\b([^>]*)>([\s\S]*?)<\/link>/g)].map((m) => {
    const mesh = m[2].match(/<visual>[\s\S]*?<mesh\b([^>]*?)\/?>/);
    return { name: attr(m[1], "name") ?? "", mesh: mesh ? attr(mesh[1], "filename") : undefined };
  });
  const joints = [...xml.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)].map((m) => {
    const tag = (t: string) => m[2].match(new RegExp(`<${t}\\b([^>]*?)\\/?>`))?.[1] ?? "";
    return {
      name: attr(m[1], "name") ?? "",
      type: attr(m[1], "type") ?? "fixed",
      parent: attr(tag("parent"), "link") ?? "",
      child: attr(tag("child"), "link") ?? "",
      xyz: nums(attr(tag("origin"), "xyz"), [0, 0, 0]),
      rpy: nums(attr(tag("origin"), "rpy"), [0, 0, 0]),
      axis: nums(attr(tag("axis"), "xyz"), [1, 0, 0]),
      lower: Number(attr(tag("limit"), "lower") ?? 0),
      upper: Number(attr(tag("limit"), "upper") ?? 0),
    };
  });
  return { links, joints };
}

/** Column-major 4×4 from a URDF origin (rpy is fixed-axis X, then Y, then Z: R = Rz·Ry·Rx). */
function originMatrix(xyz: number[], rpy: number[]): number[] {
  const [r, p, y] = rpy;
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  const R = [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, xyz[0], xyz[1], xyz[2], 1];
}
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const applyPoint = (m: number[], v: number[]) => [0, 1, 2].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]);
const applyDir = (m: number[], v: number[]) => [0, 1, 2].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2]);
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** True when the buffer is a zip (Lux3D articulation returns a URDF package, not a GLB). */
export const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * Lux3D articulation output (a zip: urdf/robot.urdf + one GLB per link) → one GLB with one mesh node per
 * link (part-0 = first link in the URDF, …), each baked into the object frame and centred on the bounding
 * box like every other object, plus the joints as pivot + axis in that frame. Measured Nov 9 on a door:
 * links frame + door, one revolute joint about +Y, 0 to 1.57 rad; the URDF is Y-up like the meshes.
 */
export async function articulatedToGlb(zip: Buffer): Promise<{ glb: Buffer; joints: Joint[]; links: string[] }> {
  const files = unzipSync(new Uint8Array(zip)) as Record<string, Uint8Array>;
  const urdfName = Object.keys(files).find((k) => k.toLowerCase().endsWith(".urdf"));
  if (!urdfName) throw new Error("The articulation package has no URDF.");
  const dir = urdfName.includes("/") ? urdfName.slice(0, urdfName.lastIndexOf("/") + 1) : "";
  const { links, joints } = parseUrdf(new TextDecoder().decode(files[urdfName]));
  const meshLinks = links.filter((l) => l.mesh && files[dir + l.mesh]);
  if (meshLinks.length === 0) throw new Error("The articulation package has no meshes.");

  // world transform per link: roots = identity, child = parent · origin
  const world = new Map<string, number[]>();
  const children = new Set(joints.map((j) => j.child));
  for (const l of links) if (!children.has(l.name)) world.set(l.name, IDENTITY);
  for (let pass = 0; pass < links.length; pass++)
    for (const j of joints) if (world.has(j.parent) && !world.has(j.child)) world.set(j.child, mul(world.get(j.parent)!, originMatrix(j.xyz, j.rpy)));

  const io = await gltfIO();
  const target = new Document();
  const scene = target.createScene("Scene");
  target.getRoot().setDefaultScene(scene);
  const groups: GNode[] = [];
  for (const [i, l] of meshLinks.entries()) {
    const src = await io.readBinary(files[dir + l.mesh!]);
    const srcScenes = src.getRoot().listScenes();
    const map = mergeDocuments(target, src);
    const group = target.createNode(`part-${i}`);
    scene.addChild(group);
    for (const sc of srcScenes) {
      const t = map.get(sc) as unknown as import("@gltf-transform/core").Scene;
      for (const n of t.listChildren()) group.addChild(n);
      t.dispose();
    }
    group.setMatrix((world.get(l.name) ?? IDENTITY) as unknown as mat4);
    groups.push(group);
  }
  for (const s of target.getRoot().listScenes()) if (s !== scene) s.dispose();

  // bake every mesh into the object frame; one mesh node per link
  for (const [i, g] of groups.entries()) {
    const meshes: GNode[] = [];
    const walk = (n: GNode) => {
      if (n.getMesh()) meshes.push(n);
      n.listChildren().forEach(walk);
    };
    walk(g);
    for (const n of meshes) {
      clearNodeParent(n);
      clearNodeTransform(n);
    }
    g.dispose();
    meshes.forEach((n, k) => {
      n.setName(meshes.length === 1 ? `part-${i}` : `part-${i}-mesh-${k}`);
      n.getMesh()!.setName(`part-${i}`);
    });
  }
  // centre on the bounding box
  const b = getBounds(scene);
  const c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
  for (const n of scene.listChildren()) {
    n.setTranslation([-c[0], -c[1], -c[2]]);
    clearNodeTransform(n);
  }
  const index = new Map(meshLinks.map((l, i) => [l.name, i]));
  const out: Joint[] = joints
    .filter((j) => index.has(j.parent) && index.has(j.child) && j.type !== "fixed")
    .map((j) => {
      const m = world.get(j.child) ?? IDENTITY;
      const p = applyPoint(m, [0, 0, 0]).map((v, k) => r4(v - c[k]));
      const a = applyDir(m, j.axis);
      const len = Math.hypot(a[0], a[1], a[2]) || 1;
      return {
        name: j.name,
        type: j.type,
        parent: index.get(j.parent)!,
        child: index.get(j.child)!,
        pivot: p as Joint["pivot"],
        axis: a.map((v) => r4(v / len)) as Joint["axis"],
        lower: j.lower,
        upper: j.upper,
      };
    });
  await target.transform(unpartition());
  return { glb: Buffer.from(await io.writeBinary(target)), joints: out, links: meshLinks.map((l) => l.name) };
}

/** Bounding box (Y-up metres) and triangle count of a raw Lux3D GLB, used to decide on part-split. */
export async function measureGlb(glb: Buffer): Promise<{ bbox: BBox; maxDim: number; tris: number; meshes: number; animated: boolean }> {
  const io = await gltfIO();
  const doc = await io.readBinary(new Uint8Array(glb));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const b = getBounds(scene);
  const bbox: BBox = { min: b.min.map(r4) as BBox["min"], max: b.max.map(r4) as BBox["max"] };
  const maxDim = Math.max(...[0, 1, 2].map((k) => bbox.max[k] - bbox.min[k]));
  return { bbox, maxDim, tris: triangleCount(doc), meshes: meshNodes(doc).length, animated: root.listAnimations().length > 0 || root.listSkins().length > 0 };
}

export type { mat4 };
