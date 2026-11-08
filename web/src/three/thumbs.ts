// One shared offscreen renderer that turns library GLBs into small studio thumbnails, one at a
// time, cached for the session. Saves a WebGL context per card.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { loadVisual } from "./arenaView";

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
const cache = new Map<string, Promise<string>>();
let chain: Promise<unknown> = Promise.resolve();

function init(size: number) {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 3);
  scene.add(key, new THREE.HemisphereLight(0xffffff, 0x777777, 0.6));
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
}

export function thumbnail(url: string, size = 256): Promise<string> {
  const k = `${url}@${size}`;
  let p = cache.get(k);
  if (p) return p;
  p = new Promise<string>((resolve, reject) => {
    chain = chain.then(async () => {
      try {
        init(size);
        const src = await loadVisual(url);
        const obj = src.clone(true);
        const box = new THREE.Box3().setFromObject(obj);
        const c = box.getCenter(new THREE.Vector3());
        const s = box.getSize(new THREE.Vector3());
        obj.position.sub(c);
        const holder = new THREE.Group();
        holder.add(obj);
        holder.rotation.y = -0.6;
        scene.add(holder);
        const r = Math.max(s.x, s.y, s.z) * 0.5;
        const d = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.95;
        camera.position.set(d * 0.55, d * 0.42, d * 0.72);
        camera.lookAt(0, 0, 0);
        renderer!.setSize(size, size, false);
        renderer!.render(scene, camera);
        const data = renderer!.domElement.toDataURL("image/webp", 0.85);
        scene.remove(holder);
        resolve(data);
      } catch (e) {
        cache.delete(k);
        reject(e);
      }
    });
  });
  cache.set(k, p);
  return p;
}
