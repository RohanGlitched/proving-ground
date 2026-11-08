"use client";
// Scroll scrubs the materializer: each step of the Lux3D pipeline happens as you read about it.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Stage } from "@/three/stage";
import { Materializer, MATERIALIZE_SECONDS } from "@/three/materializer";
import { CameraFrame } from "@/components/ui/CameraFrame";
import { SHOWCASE, showcase } from "@/lib/samples";
import { loadVisual } from "@/three/arenaView";

const STEPS = [
  {
    title: "Describe it, or photograph it",
    body: "A sentence or a photo is the whole input. Photos are resized and stripped of their metadata, then uploaded to Aholo.",
    at: 0.0,
  },
  {
    title: "Lux3D builds it at its real size",
    body: "Lux3D's image-to-3D or text-to-3D returns a textured mesh in metres. No one types in the dimensions.",
    at: 0.95,
  },
  {
    title: "Part-split finds the pieces",
    body: "A second Lux3D pass separates the parts it is made of, so the legs are not one solid block with the seat.",
    at: 2.2,
  },
  {
    title: "Each piece becomes a solid",
    body: "Every part is wrapped in its convex hull and given a mass. That is exactly what the physics engine feels.",
    at: 2.8,
  },
  {
    title: "It drops in front of the robot",
    body: "The parts close up, the object falls into the arena, and the walking controller has to deal with it.",
    at: MATERIALIZE_SECONDS,
  },
];

export function PipelineScroll() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [parts, setParts] = useState<number | null>(null);
  const progress = useRef(0);

  useEffect(() => {
    const stage = new Stage({ canvas: canvasRef.current!, dark: true, controls: false });
    stage.camera.position.set(2.05, 1.35, 2.3);
    stage.camera.lookAt(0, 0.42, 0);
    let mat: Materializer | null = null;
    let base = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    showcase().then(async (sc) => {
      if (!sc) return;
      const scene = await loadVisual(sc.url);
      mat = new Materializer(scene);
      base = -mat.bbox.min.y;
      mat.group.position.y = base;
      stage.scene.add(mat.group);
      const s = mat.size;
      setSize(`${Math.round(s.x * 100)} × ${Math.round(s.z * 100)} × ${Math.round(s.y * 100)} cm`);
      setParts(mat.partCount);
      stage.camera.lookAt(0, s.y * 0.5, 0);
    });
    let spin = 0;
    stage.onFrame((dt) => {
      if (!mat) return;
      const p = progress.current; // 0..1 across the section
      const total = MATERIALIZE_SECONDS + 0.9; // + drop
      const t = reduced ? total : p * total;
      mat.seek(Math.min(t, MATERIALIZE_SECONDS));
      // drop: lift then fall with a small bounce
      const d = Math.max(0, t - MATERIALIZE_SECONDS) / 0.9;
      const lift = t < MATERIALIZE_SECONDS ? Math.min(1, t / 0.8) * 0.25 : 0.25 * (1 - d);
      const bounce = d > 0.7 ? Math.sin(((d - 0.7) / 0.3) * Math.PI) * 0.03 : 0;
      mat.group.position.y = base + Math.max(0, lift) + bounce;
      spin += dt * 0.18;
      mat.group.rotation.y = spin;
    });
    stage.start();

    const onScroll = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, span)));
      progress.current = p;
      const t = p * (MATERIALIZE_SECONDS + 0.9);
      let s = 0;
      STEPS.forEach((st, i) => {
        if (t >= st.at) s = i;
      });
      setStep(s);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      stage.dispose();
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-[420vh]">
      <div className="sticky top-14 flex h-[calc(100vh-3.5rem)] flex-col md:flex-row">
        <div className="relative order-2 flex flex-col justify-center px-4 py-6 sm:px-6 md:order-1 md:w-[42%] md:pl-[max(1.5rem,calc((100vw-1400px)/2+1.5rem))]">
          <h2 className="placard-sm text-[25px] sm:text-[31px]">From a sentence to a solid in five steps</h2>
          <ol className="mt-6 space-y-1">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className={`rounded-[3px] border-l-[3px] px-4 py-3 transition-colors duration-300 ${
                  i === step ? "border-target bg-paper" : "border-transparent opacity-45"
                }`}
              >
                <div className="flex items-baseline gap-3">
                  <span className="data text-[13px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-semibold">{s.title}</span>
                </div>
                <p className={`mt-1 pl-8 text-[15px] leading-relaxed text-ink-2 ${i === step ? "block" : "hidden md:block md:h-0 md:overflow-hidden"}`}>
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
        <div className="order-1 h-[46vh] p-3 md:order-2 md:h-auto md:flex-1 md:p-6 md:pl-0">
          <CameraFrame
            label="CAM 02 · BENCH"
            className="h-full rounded-[4px]"
            right={
              <span className="flex flex-col items-end gap-0.5 sm:block">
                <span>{parts != null ? `${parts} PARTS` : "LOADING"}</span>
                {size && (
                  <span>
                    <span className="hidden sm:inline"> · </span>
                    {size.toUpperCase()}
                  </span>
                )}
              </span>
            }
            bottomRight={<span>{SHOWCASE.prompt}</span>}
          >
            <canvas ref={canvasRef} className="block h-full w-full" aria-label="A Lux3D object being generated, split into parts and wrapped in hulls" />
          </CameraFrame>
        </div>
      </div>
    </div>
  );
}
