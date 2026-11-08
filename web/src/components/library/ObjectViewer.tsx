"use client";
import { useEffect, useRef, useState } from "react";
import { CameraFrame } from "@/components/ui/CameraFrame";
import { PHASE_COPY, type MaterializePhase } from "@/three/materializer";

/** A bench camera for one object: replays its materialization (points, parts, hulls). */
export function ObjectViewer({ url, label }: { url: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const replay = useRef<() => void>(() => {});
  const [phase, setPhase] = useState<MaterializePhase | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let alive = true;
    (async () => {
      const [{ Stage }, { Materializer }, { loadVisual }] = await Promise.all([import("@/three/stage"), import("@/three/materializer"), import("@/three/arenaView")]);
      if (!alive || !canvasRef.current) return;
      const stage = new Stage({ canvas: canvasRef.current, dark: true });
      dispose = () => stage.dispose();
      try {
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
    <CameraFrame label={`BENCH · ${label.toUpperCase()}`} className="h-full rounded-[4px]" bottomRight={<span>{phase ? PHASE_COPY[phase] : err ? "Could not load" : "Loading"}</span>}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`3D view of ${label}`} />
      <button onClick={() => replay.current()} className="absolute bottom-12 right-5 rounded-[8px] bg-white/90 px-3 py-1.5 text-[13px] font-semibold text-ink">
        Replay the build
      </button>
    </CameraFrame>
  );
}
