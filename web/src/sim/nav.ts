// Navigation layer: turns a goal into velocity commands for the (blind) walking policy.
// blind: walk forward, steer to face the goal. planner: occupancy grid from hull footprints,
// inflated by the robot radius, A* plus string pulling, then pure pursuit.
import { distToPolygon } from './hull';
import type { Command } from './types';

export const NAV_LIMITS = { vxMax: 0.6, yawMax: 0.8 };

export interface NavConfig {
  speed: number; // forward speed (m/s), clamped to 0..vxMax
  resolution: number; // grid cell (m)
  hardRadius: number; // cells closer than this to a footprint are blocked
  softRadius: number; // cost ramps down to 1 at this distance
  lookahead: number; // pure pursuit lookahead (m)
}

export const DEFAULT_NAV: NavConfig = { speed: 0.5, resolution: 0.05, hardRadius: 0.35, softRadius: 0.65, lookahead: 0.55 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Blind walker: constant forward speed, P control on heading to the goal. */
export function blindCommand(x: number, y: number, yaw: number, gx: number, gy: number, speed: number, out: Command): Command {
  const e = wrap(Math.atan2(gy - y, gx - x) - yaw);
  out.vx = clamp(speed, 0, NAV_LIMITS.vxMax);
  out.vy = 0;
  out.yaw = clamp(1.5 * e, -NAV_LIMITS.yawMax, NAV_LIMITS.yawMax);
  return out;
}

/** Follows a polyline with pure pursuit. Slows and turns in place when the heading error is large. */
export function pursuitCommand(x: number, y: number, yaw: number, path: number[], speed: number, lookahead: number, goalDist: number, out: Command): Command {
  // closest segment
  let best = Infinity, bi = 0, bt = 0;
  for (let i = 0; i + 3 < path.length; i += 2) {
    const ax = path[i], ay = path[i + 1], ex = path[i + 2] - ax, ey = path[i + 3] - ay;
    const L = ex * ex + ey * ey;
    const t = L > 0 ? clamp(((x - ax) * ex + (y - ay) * ey) / L, 0, 1) : 0;
    const d = Math.hypot(x - ax - t * ex, y - ay - t * ey);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  // walk lookahead along the path from the closest point
  let rem = lookahead;
  let px = path[bi] + bt * (path[bi + 2] - path[bi]), py = path[bi + 1] + bt * (path[bi + 3] - path[bi + 1]);
  let i = bi;
  let tx = path[path.length - 2], ty = path[path.length - 1];
  for (; i + 3 < path.length; i += 2) {
    const nx = path[i + 2], ny = path[i + 3];
    const seg = Math.hypot(nx - px, ny - py);
    if (seg >= rem) { tx = px + ((nx - px) * rem) / seg; ty = py + ((ny - py) * rem) / seg; break; }
    rem -= seg; px = nx; py = ny;
  }
  const e = wrap(Math.atan2(ty - y, tx - x) - yaw);
  const v = clamp(speed, 0, NAV_LIMITS.vxMax);
  const turnFactor = clamp(1 - Math.abs(e) / (Math.PI / 3), 0, 1);
  out.vx = v * turnFactor * clamp(0.4 + goalDist, 0, 1);
  out.vy = 0;
  out.yaw = clamp(1.5 * e, -NAV_LIMITS.yawMax, NAV_LIMITS.yawMax);
  return out;
}

export interface Grid {
  x0: number; y0: number; nx: number; ny: number; res: number;
  cost: Float32Array; // 1 = free, larger = near obstacles, BLOCKED = inside inflation
}

export const BLOCKED = 1e4;

/** Builds a cost grid from convex footprint polygons (flat CCW xy arrays). */
export function buildGrid(polys: number[][], bounds: [number, number, number, number], cfg: NavConfig): Grid {
  const res = cfg.resolution;
  const [bx0, by0, bx1, by1] = bounds;
  const nx = Math.max(2, Math.ceil((bx1 - bx0) / res)), ny = Math.max(2, Math.ceil((by1 - by0) / res));
  const cost = new Float32Array(nx * ny).fill(1);
  const R = cfg.softRadius;
  for (const poly of polys) {
    if (poly.length < 2) continue;
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let k = 0; k < poly.length; k += 2) {
      mnx = Math.min(mnx, poly[k]); mxx = Math.max(mxx, poly[k]);
      mny = Math.min(mny, poly[k + 1]); mxy = Math.max(mxy, poly[k + 1]);
    }
    const i0 = clamp(Math.floor((mnx - R - bx0) / res), 0, nx - 1), i1 = clamp(Math.ceil((mxx + R - bx0) / res), 0, nx - 1);
    const j0 = clamp(Math.floor((mny - R - by0) / res), 0, ny - 1), j1 = clamp(Math.ceil((mxy + R - by0) / res), 0, ny - 1);
    for (let j = j0; j <= j1; j++) {
      const cy = by0 + (j + 0.5) * res;
      for (let i = i0; i <= i1; i++) {
        const cx = bx0 + (i + 0.5) * res;
        const d = distToPolygon(cx, cy, poly);
        let c = 1;
        if (d <= 0) c = BLOCKED * 4;
        else if (d < cfg.hardRadius) c = BLOCKED;
        else if (d < R) c = 1 + 6 * (R - d) / (R - cfg.hardRadius);
        const k = j * nx + i;
        if (c > cost[k]) cost[k] = c;
      }
    }
  }
  return { x0: bx0, y0: by0, nx, ny, res, cost };
}

/** A* (8-connected) from start to goal world xy. Returns a smoothed polyline (flat xy) or null. */
export function planPath(g: Grid, sx: number, sy: number, gx: number, gy: number): number[] | null {
  const { nx, ny, res, cost } = g;
  const cell = (x: number, y: number) => {
    const i = clamp(Math.floor((x - g.x0) / res), 0, nx - 1), j = clamp(Math.floor((y - g.y0) / res), 0, ny - 1);
    return j * nx + i;
  };
  const s = cell(sx, sy);
  let goal = cell(gx, gy);
  if (cost[goal] >= BLOCKED) goal = nearestFree(g, goal);
  const N = nx * ny;
  const gs = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();
  const gi = goal % nx, gj = (goal / nx) | 0;
  const h = (k: number) => {
    const dx = Math.abs((k % nx) - gi), dy = Math.abs(((k / nx) | 0) - gj);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  gs[s] = 0;
  heap.push(s, h(s));
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  let found = false;
  while (heap.size) {
    const k = heap.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) { found = true; break; }
    const i = k % nx, j = (k / nx) | 0;
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d], jj = j + DJ[d];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const n = jj * nx + ii;
      if (closed[n]) continue;
      const step = d < 4 ? 1 : Math.SQRT2;
      const ng = gs[k] + step * 0.5 * (cost[k] + cost[n]);
      if (ng < gs[n]) { gs[n] = ng; from[n] = k; heap.push(n, ng + h(n)); }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let k = goal; k !== -1; k = from[k]) cells.push(k);
  cells.reverse();
  // string pulling: keep a waypoint only when the straight segment would cross costlier cells
  const pts: number[] = [sx, sy];
  let anchor = 0;
  const cx = (k: number) => g.x0 + ((k % nx) + 0.5) * res, cy = (k: number) => g.y0 + (((k / nx) | 0) + 0.5) * res;
  for (let i = 2; i < cells.length; i++) {
    if (!lineFree(g, cx(cells[anchor]), cy(cells[anchor]), cx(cells[i]), cy(cells[i]), 1.05)) {
      anchor = i - 1;
      pts.push(cx(cells[anchor]), cy(cells[anchor]));
    }
  }
  const last = cells[cells.length - 1];
  if (cost[cell(gx, gy)] < BLOCKED) pts.push(gx, gy);
  else pts.push(cx(last), cy(last));
  return pts;
}

function lineFree(g: Grid, ax: number, ay: number, bx: number, by: number, maxCost: number) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (g.res * 0.5));
  for (let s = 0; s <= n; s++) {
    const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n;
    const i = Math.floor((x - g.x0) / g.res), j = Math.floor((y - g.y0) / g.res);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return false;
    if (g.cost[j * g.nx + i] > maxCost) return false;
  }
  return true;
}

function nearestFree(g: Grid, k0: number) {
  const seen = new Uint8Array(g.nx * g.ny);
  const q = [k0];
  seen[k0] = 1;
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    if (g.cost[k] < BLOCKED) return k;
    const i = k % g.nx, j = (k / g.nx) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
      const n = jj * g.nx + ii;
      if (!seen[n]) { seen[n] = 1; q.push(n); }
    }
  }
  return k0;
}

/** Sum of cell costs along a polyline from a point (used to decide when to replan). */
export function pathBlocked(g: Grid, path: number[], fromIndex = 0) {
  for (let i = fromIndex; i + 3 < path.length; i += 2) {
    if (!lineFree(g, path[i], path[i + 1], path[i + 2], path[i + 3], BLOCKED - 1)) return true;
  }
  return false;
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    const { k, p } = this;
    k.push(key); p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const u = (i - 1) >> 1;
      if (p[u] <= p[i]) break;
      [k[u], k[i]] = [k[i], k[u]]; [p[u], p[i]] = [p[i], p[u]];
      i = u;
    }
  }
  pop() {
    const { k, p } = this;
    const top = k[0];
    const lk = k.pop()!, lp = p.pop()!;
    if (k.length) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}
