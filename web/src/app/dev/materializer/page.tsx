"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Stage } from "@/three/stage";
import { Materializer, PHASE_COPY, type MaterializePhase } from "@/three/materializer";
import { CameraFrame } from "@/components/ui/CameraFrame";

export default function DevMaterializer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<MaterializePhase | null>(null);
  const [info, setInfo] = useState("");
  const replay = useRef<() => void>(() => {});

  useEffect(() => {
    const stage = new Stage({ canvas: canvasRef.current!, dark: true });
    let mat: Materializer | null = null;
    new GLTFLoader().load("/dev/chair-parts.glb", (g) => {
      mat = new Materializer(g.scene);
      mat.onPhase = setPhase;
      // stand on the floor
      mat.group.position.y = -mat.bbox.min.y;
      stage.scene.add(mat.group);
      setInfo(`${mat.partCount} parts · ${mat.size.x.toFixed(2)} × ${mat.size.y.toFixed(2)} × ${mat.size.z.toFixed(2)} m`);
      stage.controls?.target.set(0, mat.size.y / 2, 0);
      stage.camera.position.set(1.6, 1.2, 1.9);
      replay.current = () => mat?.reset();
    });
    const freeze = Number(new URLSearchParams(location.search).get("t") ?? "NaN");
    stage.onFrame((dt) => {
      if (!mat) return;
      if (Number.isFinite(freeze)) {
        mat.reset();
        mat.update(freeze);
      } else mat.update(dt);
    });
    stage.start();
    return () => stage.dispose();
  }, []);

  return (
    <main className="min-h-screen p-6">
      <CameraFrame label="CAM 01 · MATERIALIZER" className="h-[80vh] rounded" clock={() => performance.now() / 1000}>
        <canvas ref={canvasRef} className="block h-full w-full" />
      </CameraFrame>
      <div className="mt-4 flex items-center gap-4">
        <button className="rounded-[10px] bg-target px-4 py-2 font-semibold" onClick={() => replay.current()}>
          Replay
        </button>
        <span>{phase ? PHASE_COPY[phase] : "loading"}</span>
        <span className="data text-ink-3">{info}</span>
      </div>
    </main>
  );
}
