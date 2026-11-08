// GLB -> collision parts for the sim, and a robot-ready export (MJCF + per-part STL).
//
// Frame convention: Lux3D GLBs are Y-up, metric, centred. The sim works in Z-up. This module converts
// (x, y, z)_gltf -> (x, -z, y)_sim, i.e. a +90 degree rotation about X. The renderer must apply the same
// fixed rotation to the visual GLB (three: glbRoot.rotation.x = Math.PI / 2 inside the Z-up world group),
// and then place it at the object's body pose. No other offset is applied: the object frame origin is the
// GLB origin. The engine rests the object's lowest point on the floor unless SceneObject.z is given.
import { WebIO, type Document } from '@gltf-transform/core';
import { bbox, boundedHull, clusterPoints, convexHull } from './hull';
import type { CollisionPart } from './types';
import { DEFAULT_DENSITY, MASS_MAX, MASS_MIN } from './engine';

export interface ObjectAsset {
  /** Hull points per part (object frame, Z up, meters). part.volume is the part's solid volume (used for mass). */
  parts: CollisionPart[];
  bboxMeters: { min: number[]; max: number[]; size: number[] };
  /** Solid volume (m^3): the closed mesh's signed volume, or 35% of the hull volume for open meshes. */
  volume: number;
  hullVolume: number; // total convex hull volume (m^3)
  /** Mass at the given density, clamped like the engine does. */
  mass: number;
  split: 'nodes' | 'auto' | 'single';
  metadata: Record<string, unknown> | null; // extras.lux3d_metadata when present
}

export interface GlbOptions {
  /** 'auto' splits single-mesh objects that are clearly concave; 'none' keeps one hull per mesh node. */
  split?: 'auto' | 'none';
  maxParts?: number; // for auto split (default 8)
  density?: number; // kg/m^3 (default 400)
  /** Parts whose largest extent is below this are dropped (default 0.01 m). */
  minPartSize?: number;
  /** Max hull vertices per part (default 96). */
  maxVerts?: number;
}

/** Reads a GLB (bytes) and returns Z-up collision parts. Works in the browser and in Node. */
export async function glbToParts(glb: Uint8Array | ArrayBuffer, opts: GlbOptions = {}): Promise<ObjectAsset> {
  const bytes = glb instanceof Uint8Array ? glb : new Uint8Array(glb);
  const doc = await new WebIO().readBinary(bytes);
  return documentToParts(doc, opts);
}

export function documentToParts(doc: Document, opts: GlbOptions = {}): ObjectAsset {
  const minSize = opts.minPartSize ?? 0.01;
  const maxVerts = opts.maxVerts ?? 96;
  const root = doc.getRoot();
  const extras = root.getExtras() as Record<string, unknown>;
  const metadata = (extras?.lux3d_metadata as Record<string, unknown>) ?? null;
  const yup = metadata?.yup !== false; // glTF is Y-up by spec
  const nodeClouds: Float32Array[] = [];
  const nodeVolumes: number[] = [];
  const el = [0, 0, 0];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const pts: number[] = [];
    let vol = 0;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const base = pts.length / 3;
      for (let i = 0, n = pos.getCount(); i < n; i++) {
        pos.getElement(i, el);
        const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
        const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
        const z = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
        if (yup) pts.push(x, -z, y);
        else pts.push(x, y, z);
      }
      if (prim.getMode() === 4) {
        const idx = prim.getIndices();
        const cnt = idx ? idx.getCount() : pos.getCount();
        for (let i = 0; i + 2 < cnt; i += 3) {
          const a = 3 * (base + (idx ? idx.getScalar(i) : i)), b = 3 * (base + (idx ? idx.getScalar(i + 1) : i + 1)), c = 3 * (base + (idx ? idx.getScalar(i + 2) : i + 2));
          vol += (pts[a] * (pts[b + 1] * pts[c + 2] - pts[b + 2] * pts[c + 1]) - pts[a + 1] * (pts[b] * pts[c + 2] - pts[b + 2] * pts[c]) + pts[a + 2] * (pts[b] * pts[c + 1] - pts[b + 1] * pts[c])) / 6;
        }
      }
    }
    if (pts.length >= 12) { nodeClouds.push(Float32Array.from(pts)); nodeVolumes.push(vol); }
  }
  let clouds = nodeClouds;
  let cloudVolumes: (number | null)[] = nodeVolumes;
  let split: ObjectAsset['split'] = nodeClouds.length > 1 ? 'nodes' : 'single';
  if (nodeClouds.length === 1 && (opts.split ?? 'auto') === 'auto') {
    const parts = autoSplit(nodeClouds[0], opts.maxParts ?? 8);
    if (parts.length > 1) { clouds = parts; split = 'auto'; cloudVolumes = parts.map(() => null); }
  }
  const all = concat(nodeClouds);
  const bb = bbox(all);
  const parts: CollisionPart[] = [];
  const hullVols: number[] = [];
  clouds.forEach((c, i) => {
    const b = bbox(c);
    if (Math.max(...b.size) < minSize) return;
    const h = boundedHull(c, maxVerts);
    // solid volume: closed-mesh volume when it is plausible, else a fraction of the hull
    const mv = cloudVolumes[i];
    const solid = mv !== null && Math.abs(mv) > 0.02 * h.volume && Math.abs(mv) <= 1.05 * h.volume ? Math.abs(mv) : NaN;
    parts.push({ points: h.verts, volume: solid, name: `part${i}` });
    hullVols.push(h.volume);
  });
  const hullVolume = hullVols.reduce((s, v) => s + v, 0);
  if (split === 'auto') {
    // one closed mesh cut into pieces: share its solid volume by hull volume
    const mv = Math.abs(nodeVolumes[0]);
    const total = mv > 0.02 * hullVolume && mv <= 1.05 * hullVolume ? mv : 0.35 * hullVolume;
    parts.forEach((p, i) => { p.volume = (total * hullVols[i]) / Math.max(hullVolume, 1e-12); });
  } else {
    parts.forEach((p, i) => { if (!Number.isFinite(p.volume!)) p.volume = 0.35 * hullVols[i]; });
  }
  const volume = parts.reduce((s, p) => s + p.volume!, 0);
  const mass = Math.min(MASS_MAX, Math.max(MASS_MIN, volume * (opts.density ?? DEFAULT_DENSITY)));
  return { parts, bboxMeters: bb, volume, hullVolume, mass, split, metadata };
}

function concat(a: Float32Array[]) {
  const out = new Float32Array(a.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of a) { out.set(x, o); o += x.length; }
  return out;
}

/**
 * Approximate convex decomposition by recursive axis-aligned cuts: a cluster is cut where the two
 * halves' hull volumes shrink the most, while that saves at least 25%. Good for chairs, tables, shelves.
 */
export function autoSplit(points: Float32Array, maxParts = 8): Float32Array[] {
  const b0 = bbox(points);
  const base = clusterPoints(points, Math.max(...b0.size) / 80);
  type Cl = { pts: Float32Array; vol: number; gain: number; split: [Float32Array, Float32Array] | null; vols: [number, number] };
  const evaluate = (pts: Float32Array): Cl => {
    const vol = convexHull(pts).volume;
    const c: Cl = { pts, vol, gain: 0, split: null, vols: [0, 0] };
    if (pts.length / 3 < 60 || vol < 1e-6) return c;
    const b = bbox(pts);
    const maxExtent = Math.max(...b.size);
    for (let axis = 0; axis < 3; axis++) {
      if (b.size[axis] < 0.15 * maxExtent) continue;
      for (let f = 0.15; f < 0.86; f += 0.07) {
        const cut = b.min[axis] + f * b.size[axis];
        const [l, r] = partition(pts, axis, cut);
        if (l.length < 36 || r.length < 36) continue;
        const vl = convexHull(l).volume, vr = convexHull(r).volume;
        const gain = 1 - (vl + vr) / vol;
        if (gain > c.gain) { c.gain = gain; c.split = [l, r]; c.vols = [vl, vr]; }
      }
    }
    return c;
  };
  const done: Float32Array[] = [];
  const open: Cl[] = [evaluate(base)];
  while (open.length && open.length + done.length < maxParts) {
    open.sort((a, b) => b.gain * b.vol - a.gain * a.vol);
    const c = open[0];
    if (!c.split || c.gain < 0.25) break;
    open.shift();
    open.push(evaluate(c.split[0]), evaluate(c.split[1]));
  }
  return [...done, ...open.map((c) => c.pts)];
}

function partition(pts: Float32Array, axis: number, cut: number): [Float32Array, Float32Array] {
  const l: number[] = [], r: number[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    const dst = pts[i + axis] < cut ? l : r;
    dst.push(pts[i], pts[i + 1], pts[i + 2]);
  }
  return [Float32Array.from(l), Float32Array.from(r)];
}

/** Binary STL of a convex hull. */
export function hullToStl(points: Float32Array): Uint8Array {
  const h = convexHull(points);
  const n = h.tris.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  const header = 'Proving Ground convex part';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  const v = h.verts;
  for (let t = 0; t < n; t++) {
    const a = 3 * h.tris[3 * t], b = 3 * h.tris[3 * t + 1], c = 3 * h.tris[3 * t + 2];
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    for (const f of [nx, ny, nz, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]]) { dv.setFloat32(o, f, true); o += 4; }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

export interface MjcfExport {
  /** Standalone MJCF: a free body with one mesh geom per convex part, meshes in meshes/. */
  xml: string;
  /** File name -> STL bytes (paths relative to the MJCF). */
  files: Record<string, Uint8Array>;
  mass: number;
}

/** Robot-ready pack: MJCF + per-part STL. Units meters, Z up, mass from hull volume x density. */
export function toMJCF(object: { name: string; parts: CollisionPart[]; density?: number; mass?: number; friction?: number }): MjcfExport {
  const safe = object.name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'object';
  const files: Record<string, Uint8Array> = {};
  const vols = object.parts.map((p) => p.volume ?? convexHull(p.points).volume);
  const volume = vols.reduce((s, v) => s + v, 0);
  const mass = Math.min(MASS_MAX, Math.max(MASS_MIN, object.mass ?? volume * (object.density ?? DEFAULT_DENSITY)));
  const fr = object.friction ?? 0.8;
  const meshes: string[] = [];
  const geoms: string[] = [];
  object.parts.forEach((p, i) => {
    const f = `meshes/${safe}_part${i}.stl`;
    files[f] = hullToStl(p.points);
    meshes.push(`    <mesh name="${safe}_part${i}" file="${f}"/>`);
    const m = (mass * vols[i]) / Math.max(volume, 1e-9);
    geoms.push(`      <geom type="mesh" mesh="${safe}_part${i}" mass="${m.toFixed(5)}" friction="${fr} 0.005 0.0001" condim="3"/>`);
  });
  const xml = `<!-- ${safe}: ${object.parts.length} convex parts, ${mass.toFixed(3)} kg, generated by Proving Ground. Units m, Z up. -->
<mujoco model="${safe}">
  <compiler angle="radian"/>
  <asset>
${meshes.join('\n')}
  </asset>
  <worldbody>
    <geom name="floor" type="plane" size="0 0 0.05"/>
    <body name="${safe}" pos="0 0 ${(-Math.min(...object.parts.map((p) => bbox(p.points).min[2])) + 0.002).toFixed(4)}">
      <freejoint/>
${geoms.join('\n')}
    </body>
  </worldbody>
</mujoco>
`;
  return { xml, files, mass };
}
