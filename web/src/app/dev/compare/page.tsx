"use client";
// Dev-only: renders the same Lux3D chair as one hull (whole mesh) or as its part-split hulls, for the report.
import { useEffect, useRef } from "react";
import { Stage } from "@/three/stage";
import { Materializer } from "@/three/materializer";
import { loadVisual } from "@/three/arenaView";

export default function DevCompare() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const mode = new URLSearchParams(location.search).get("mode") ?? "parts";
    const stage = new Stage({ canvas: ref.current!, dark: true, controls: false });
    loadVisual(mode === "whole" ? "/dev/chair.glb" : "/dev/chair-parts.glb").then((scene) => {
      const m = new Materializer(scene);
      m.finish();
      m.setHullView(true);
      m.group.position.y = -m.bbox.min.y;
      stage.scene.add(m.group);
      stage.camera.position.set(1.15, 1.0, 1.35);
      stage.camera.lookAt(0, 0.4, 0);
      document.body.dataset.ready = "1";
    });
    stage.start();
    return () => stage.dispose();
  }, []);
  return <canvas ref={ref} style={{ width: "100vw", height: "100vh", display: "block" }} />;
}
