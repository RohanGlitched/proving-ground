// Renders the Unitree G1 from the sim's visual-geom poses. MuJoCo is Z-up; three.js is Y-up.
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export type RobotVisual = { geomId: number; mesh: string; rgba: [number, number, number, number] };

/** MuJoCo (Z-up) -> three (Y-up): rotate -90 degrees about X */
export const Z_TO_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export function mjPos(out: THREE.Vector3, x: number, y: number, z: number) {
  return out.set(x, z, -y);
}
const _q = new THREE.Quaternion();
export function mjQuat(out: THREE.Quaternion, w: number, x: number, y: number, z: number) {
  _q.set(x, y, z, w);
  return out.copy(Z_TO_Y).multiply(_q);
}

const cache = new Map<string, Promise<THREE.BufferGeometry>>();
function loadSTL(url: string) {
  let p = cache.get(url);
  if (!p) {
    p = new STLLoader().loadAsync(url).then((g) => {
      g.computeVertexNormals();
      return g;
    });
    cache.set(url, p);
  }
  return p;
}

export class RobotView {
  readonly group = new THREE.Group();
  private parts: THREE.Mesh[] = [];
  private dark: THREE.MeshStandardMaterial;
  private light: THREE.MeshStandardMaterial;
  private glow: THREE.MeshStandardMaterial;
  ready: Promise<void>;

  constructor(visuals: RobotVisual[], base = "/g1/meshes/") {
    this.dark = new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.55, roughness: 0.42 });
    this.light = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.35, roughness: 0.38 });
    this.glow = new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.5, roughness: 0.4, emissive: 0xf5c400, emissiveIntensity: 0 });
    this.ready = Promise.all(
      visuals.map(async (v, i) => {
        const geo = await loadSTL(base + v.mesh);
        const isDark = v.rgba[0] < 0.4;
        const mat = v.mesh.startsWith("logo") ? this.glow : isDark ? this.dark : this.light;
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = false;
        m.matrixAutoUpdate = true;
        this.parts[i] = m;
        this.group.add(m);
      }),
    ).then(() => undefined);
  }

  /** apply poses: buf[offset + i*7 .. ] = x,y,z (MuJoCo world), w,x,y,z */
  update(buf: Float32Array, offset = 0) {
    for (let i = 0; i < this.parts.length; i++) {
      const m = this.parts[i];
      if (!m) continue;
      const o = offset + i * 7;
      mjPos(m.position, buf[o], buf[o + 1], buf[o + 2]);
      mjQuat(m.quaternion, buf[o + 3], buf[o + 4], buf[o + 5], buf[o + 6]);
    }
  }

  /** flash the chest logo, e.g. when the robot touches something */
  pulse(intensity: number) {
    this.glow.emissiveIntensity = intensity;
  }

  setTint(fallen: boolean) {
    this.dark.color.set(fallen ? 0x3a2220 : 0x24262a);
  }
}
