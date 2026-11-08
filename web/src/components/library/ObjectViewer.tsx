"use client";
import { useEffect, useRef, useState } from "react";
import { CameraFrame } from "@/components/ui/CameraFrame";
import { PHASE_COPY, type MaterializePhase } from "@/three/materializer";

/** A bench camera for one object: replays its materialization (points, parts, hulls). */
export function ObjectViewer({ url, label, animated = false }: { url: string; label: string; animated?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const replay = useRef<() => void>(() => {});
  const [phase, setPhase] = useState<MaterializePhase | null>(null);
  const [err, setErr] = useState(false);
  const [animNote, setAnimNote] = useState<string | null>(null);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let alive = true;
    (async () => {
      const [{ Stage }, { Materializer }, { loadVisual, loadAnimated }] = await Promise.all([import("@/three/stage"), import("@/three/materializer"), import("@/three/arenaView")]);
      if (!alive || !canvasRef.current) return;
      const stage = new Stage({ canvas: canvasRef.current, dark: true });
      dispose = () => stage.dispose();
      try {
        if (animated) {
          // Lux3D rig + walk cycle, or Lux3D articulation: play the clips, no build replay
          const THREE = await import("three");
          const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
          const g = await loadAnimated(url);
          if (!alive) return;
          const body = clone(g.scene);
          const box = new THREE.Box3().setFromObject(body);
          const size = box.getSize(new THREE.Vector3());
          body.position.y = -box.min.y;
          stage.scene.add(body);
          const mixer = new THREE.AnimationMixer(body);
          g.animations.forEach((c) => mixer.clipAction(c).play());
          const r = Math.max(size.x, size.y, size.z);
          stage.camera.position.set(r * 1.2, r * 0.8, r * 1.6);
          stage.controls?.target.set(0, size.y / 2, 0);
          if (stage.controls) {
            stage.controls.autoRotate = true;
            stage.controls.autoRotateSpeed = 0.6;
          }
          setPhase(null);
          setAnimNote(g.animations.length ? `Playing ${g.animations.map((c) => c.name || "clip").join(", ")}` : "No animation clip in this file");
          stage.onFrame((dt) => mixer.update(dt));
          stage.start();
          return;
        }
        const scene = await loadVisual(url);
        if (!alive) return;
        const mat = new Materializer(scene);
        mat.onPhase = setPhase;
        mat.group.position.y = -mat.bbox.min.y;
        stage.scene.add(mat.group);
        const r = Math.max(mat.size.x, mat.size.y, mat.size.z);
        stage.camera.position.set(r * 1.5, r * 1.1, r * 1.9);
        stage.controls?.target.set(0, mat.size.y / 2, 0);
        if (stage.controls) {
          stage.controls.minDistance = r * 0.6;
          stage.controls.autoRotate = true;
          stage.controls.autoRotateSpeed = 0.8;
        }
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) mat.finish();
        replay.current = () => mat.reset();
        stage.onFrame((dt) => mat.update(dt));
      } catch {
        setErr(true);
      }
      stage.start();
    })();
    return () => {
      alive = false;
      dispose?.();
    };
  }, [url]);

  return (
    <CameraFrame label={`BENCH · ${label.toUpperCase()}`} className="h-full rounded-[4px]" bottomRight={<span>{animNote ?? (phase ? PHASE_COPY[phase] : err ? "Could not load" : "Loading")}</span>}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`3D view of ${label}`} />
      {!animated && (
        <button onClick={() => replay.current()} className="absolute bottom-12 right-5 rounded-[8px] bg-white/90 px-3 py-1.5 text-[13px] font-semibold text-ink">
          Replay the build
        </button>
      )}
    </CameraFrame>
  );
}
