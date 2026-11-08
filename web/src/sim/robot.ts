// G1 asset loading and MJCF preprocessing. Works in the browser (fetch) and Node (fs) via an injected reader.
import type { PolicyWeights } from './policy';
import type { RobotVisual } from './types';

export interface RobotAssets {
  /** Original g1_12dof.xml text. */
  xml: string;
  /** Collision hull STLs by file name (meshes/<file>). */
  hulls: Record<string, Uint8Array>;
  weights: PolicyWeights;
}

export type ReadBytes = (path: string) => Promise<Uint8Array>;

const dec = new TextDecoder();

/** Loads g1_12dof.xml, the policy weights and the collision hull STLs (visual STLs are only for rendering). */
export async function loadRobotAssets(read: ReadBytes): Promise<RobotAssets> {
  const [xmlB, polB] = await Promise.all([read('g1_12dof.xml'), read('g1_policy.json')]);
  const xml = dec.decode(xmlB);
  const files = [...xml.matchAll(/<mesh\s+name="[^"]*_hull"\s+file="([^"]+)"/g)].map((m) => m[1]);
  const bufs = await Promise.all(files.map((f) => read(`meshes/${f}`)));
  const hulls: Record<string, Uint8Array> = {};
  files.forEach((f, i) => { hulls[f] = bufs[i]; });
  return { xml, hulls, weights: JSON.parse(dec.decode(polB)) as PolicyWeights };
}

/**
 * Physics-only robot MJCF: drops the visual (group 1, contype 0, density 0) geoms and their mesh assets.
 * They have no mass and no contacts, so dynamics are unchanged (verified: same 6 s walk distance).
 */
export function physicsXml(xml: string): string {
  return xml
    .replace(/<geom\b[^>]*contype="0" conaffinity="0" group="1" density="0"[^>]*\/>\s*/g, '')
    .replace(/<mesh\s+name="[^"]*_vis"\s+file="[^"]+"\s*\/>/g, '');
}

const attr = (s: string, k: string) => {
  const m = s.match(new RegExp(`\\b${k}="([^"]*)"`));
  return m ? m[1] : null;
};
const nums = (s: string | null, d: number[]) => (s ? s.trim().split(/\s+/).map(Number) : d);

/** Robot bodies in MuJoCo order and the visual meshes attached to each. */
export function parseRobotVisuals(xml: string): { bodies: string[]; visuals: RobotVisual[] } {
  const meshFile = new Map<string, string>();
  for (const m of xml.matchAll(/<mesh\s+name="([^"]+)"\s+file="([^"]+)"/g)) meshFile.set(m[1], m[2]);
  const bodies: string[] = [];
  const stack: string[] = [];
  const visuals: RobotVisual[] = [];
  for (const m of xml.matchAll(/<(\/?)(body|geom)\b([^>]*?)(\/?)>/g)) {
    const [, close, tag, rest] = m;
    if (tag === 'body') {
      if (close) stack.pop();
      else { const n = attr(rest, 'name') ?? `body${bodies.length}`; bodies.push(n); stack.push(n); }
      continue;
    }
    if (attr(rest, 'group') !== '1') continue;
    const mesh = attr(rest, 'mesh');
    if (!mesh || !stack.length) continue;
    const body = stack[stack.length - 1];
    const q = nums(attr(rest, 'quat'), [1, 0, 0, 0]);
    const rgba = nums(attr(rest, 'rgba'), [0.7, 0.7, 0.7, 1]);
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    visuals.push({
      geomId: visuals.length,
      body,
      mesh: meshFile.get(mesh) ?? `${mesh}.stl`,
      rgba: rgba as [number, number, number, number],
      pos: nums(attr(rest, 'pos'), [0, 0, 0]) as [number, number, number],
      quat: [q[0] / n, q[1] / n, q[2] / n, q[3] / n],
    });
  }
  return { bodies, visuals };
}
