// Geometry helpers: 3D convex hull (three's quickhull), volume, point clustering, 2D hulls.
import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

export interface Hull {
  verts: Float32Array; // unique hull vertices, xyz
  tris: Uint32Array; // indices into verts
  volume: number; // m^3
}

export function bbox(points: Float32Array) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = points[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  return { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

/**
 * Vertex clustering on a uniform grid. Keeps, per cell, the point farthest from the centroid,
 * so the hull of the result differs from the true hull by at most one cell.
 */
export function clusterPoints(points: Float32Array, cell: number): Float32Array {
  const n = points.length / 3;
  if (n === 0) return points;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < points.length; i += 3) { cx += points[i]; cy += points[i + 1]; cz += points[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  const b = bbox(points);
  const best = new Map<number, number>();
  const bestD = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const x = points[3 * i], y = points[3 * i + 1], z = points[3 * i + 2];
    // integer cell coords relative to the bbox min; < 2^16 each for any sane cell size
    const key = (Math.floor((x - b.min[0]) / cell) * 65536 + Math.floor((y - b.min[1]) / cell)) * 65536 + Math.floor((z - b.min[2]) / cell);
    const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
    const prev = bestD.get(key);
    if (prev === undefined || d > prev) { best.set(key, i); bestD.set(key, d); }
  }
  const out = new Float32Array(best.size * 3);
  let j = 0;
  for (const i of best.values()) { out[j++] = points[3 * i]; out[j++] = points[3 * i + 1]; out[j++] = points[3 * i + 2]; }
  return out;
}

/** Pads near-flat point sets so the hull has volume (MuJoCo rejects flat meshes). */
export function thicken(points: Float32Array, minThickness = 0.004): Float32Array {
  const b = bbox(points);
  let axis = -1;
  for (let k = 0; k < 3; k++) if (b.size[k] < minThickness) { axis = k; break; }
  if (axis < 0) return points;
  const out = new Float32Array(points.length * 2);
  const h = minThickness / 2;
  for (let i = 0; i < points.length; i += 3) {
    out.set(points.subarray(i, i + 3), i);
    out.set(points.subarray(i, i + 3), points.length + i);
    out[i + axis] -= h;
    out[points.length + i + axis] += h;
  }
  return thicken(out, minThickness); // handles a degenerate line or point too
}

/** Convex hull of a point cloud. Input is pre-clustered when large. */
export function convexHull(points: Float32Array): Hull {
  let pts = points;
  if (pts.length / 3 > 4000) {
    const b = bbox(pts);
    pts = clusterPoints(pts, Math.max(...b.size) / 96);
  }
  pts = thicken(pts);
  const vs: Vector3[] = [];
  for (let i = 0; i < pts.length; i += 3) vs.push(new Vector3(pts[i], pts[i + 1], pts[i + 2]));
  const hull = new ConvexHull().setFromPoints(vs);
  const index = new Map<Vector3, number>();
  const verts: number[] = [];
  const tris: number[] = [];
  const id = (p: Vector3) => {
    let k = index.get(p);
    if (k === undefined) { k = verts.length / 3; index.set(p, k); verts.push(p.x, p.y, p.z); }
    return k;
  };
  let volume = 0;
  for (const f of hull.faces) {
    const loop: number[] = [];
    let e = f.edge;
    do { loop.push(id(e.head().point)); e = e.next; } while (e !== f.edge);
    for (let i = 1; i + 1 < loop.length; i++) {
      const a = loop[0], b = loop[i], c = loop[i + 1];
      tris.push(a, b, c);
      const ax = verts[3 * a], ay = verts[3 * a + 1], az = verts[3 * a + 2];
      const bx = verts[3 * b], by = verts[3 * b + 1], bz = verts[3 * b + 2];
      const cx = verts[3 * c], cy = verts[3 * c + 1], cz = verts[3 * c + 2];
      volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return { verts: Float32Array.from(verts), tris: Uint32Array.from(tris), volume: Math.abs(volume) };
}

/** Hull with at most maxVerts vertices (coarsens by clustering until it fits). */
export function boundedHull(points: Float32Array, maxVerts = 96): Hull {
  let h = convexHull(points);
  if (h.verts.length / 3 <= maxVerts) return h;
  const b = bbox(h.verts);
  let cell = Math.max(...b.size) / 24;
  for (let i = 0; i < 8 && h.verts.length / 3 > maxVerts; i++) {
    h = convexHull(clusterPoints(h.verts, cell));
    cell *= 1.4;
  }
  return h;
}

/** 2D convex hull (monotone chain) of xy pairs. Returns CCW polygon as flat xy. */
export function hull2d(xy: number[]): number[] {
  const n = xy.length / 2;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => xy[2 * a] - xy[2 * b] || xy[2 * a + 1] - xy[2 * b + 1]);
  const cross = (o: number, a: number, b: number) =>
    (xy[2 * a] - xy[2 * o]) * (xy[2 * b + 1] - xy[2 * o + 1]) - (xy[2 * a + 1] - xy[2 * o + 1]) * (xy[2 * b] - xy[2 * o]);
  const lower: number[] = [], upper: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  const ring = lower.slice(0, -1).concat(upper.slice(0, -1));
  const out: number[] = [];
  for (const i of ring) out.push(xy[2 * i], xy[2 * i + 1]);
  return out;
}

/** Distance from point to a convex CCW polygon (0 inside). */
export function distToPolygon(px: number, py: number, poly: number[]): number {
  const n = poly.length / 2;
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(px - poly[0], py - poly[1]);
  let inside = n >= 3;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const ax = poly[2 * i], ay = poly[2 * i + 1];
    const bx = poly[(2 * i + 2) % (2 * n)], by = poly[(2 * i + 3) % (2 * n)];
    const ex = bx - ax, ey = by - ay;
    if (ex * (py - ay) - ey * (px - ax) < 0) inside = false;
    const L = ex * ex + ey * ey;
    const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L)) : 0;
    const d = Math.hypot(px - (ax + t * ex), py - (ay + t * ey));
    if (d < best) best = d;
  }
  return inside ? 0 : best;
}
