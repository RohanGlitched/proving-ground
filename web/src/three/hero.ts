// The home page's live camera. Phase 1 (until the sim is wired): objects materialize in a loop.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Stage } from "./stage";
import { Materializer } from "./materializer";
import { SHOWCASE } from "@/lib/samples";

export type HeroStatus = {
  phase: "loading" | "making" | "walking" | "result";
  object?: string;
  speed?: number;
  contacts?: number;
  result?: "goal" | "fell" | "timeout";
  on?: string;
};

export function startHero(canvas: HTMLCanvasElement, onStatus: (s: HeroStatus) => void) {
  const stage = new Stage({ canvas, dark: true, controls: false });
  const cam = stage.camera;
  cam.position.set(2.6, 1.5, 3.2);
  const look = new THREE.Vector3(0, 0.5, 0);
  cam.lookAt(look);
  const start = performance.now();
  let mat: Materializer | null = null;
  let base = 0;
  let wait = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  new GLTFLoader().load(SHOWCASE.visual, (g) => {
    mat = new Materializer(g.scene);
    base = -mat.bbox.min.y;
    mat.group.position.set(0, base, 0);
    stage.scene.add(mat.group);
    if (reduced) mat.finish();
    onStatus({ phase: "making", object: "kitchen chair" });
  });

  let orbit = 0;
  stage.onFrame((dt) => {
    orbit += dt * 0.06;
    cam.position.set(Math.sin(orbit) * 3.6, 1.5, Math.cos(orbit) * 3.6);
    cam.lookAt(look);
    if (!mat || reduced) return;
    if (mat.update(dt)) {
      wait += dt;
      if (wait > 3) {
        wait = 0;
        mat.reset();
      }
    }
  });
  stage.start();

  return {
    clock: () => (performance.now() - start) / 1000,
    dispose: () => stage.dispose(),
  };
}
