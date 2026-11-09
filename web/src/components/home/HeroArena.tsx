"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CameraFrame } from "@/components/ui/CameraFrame";
import { Stamp } from "@/components/ui/marks";
import type { HeroStatus } from "@/three/hero";

export function HeroArena() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clock = useRef<() => number | null>(() => null);
  const [status, setStatus] = useState<HeroStatus>({ phase: "loading" });

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    // fetch the physics client alongside the hero so the worker can start loading MuJoCo sooner
    import("@/sim/client").catch(() => undefined);
    import("@/three/hero").then(({ startHero }) => {
      if (disposed || !canvasRef.current) return;
      const h = startHero(canvasRef.current, setStatus);
      clock.current = h.clock;
      cleanup = h.dispose;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <CameraFrame
      label="CAM 01 · ARENA · LIVE"
      clock={() => clock.current()}
      className="h-[calc(100svh-3.5rem)] min-h-[560px]"
      right={<HeroReadout status={status} />}
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="Live simulation: a Unitree G1 walking controller meets objects made by Lux3D" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-cam via-cam/70 to-transparent px-4 pb-14 pt-32 sm:px-6 md:pb-16">
        <div className="pointer-events-auto mx-auto max-w-[1400px]">
          <h1 className="placard max-w-[16ch] text-[39px] text-white sm:text-[49px] md:text-[61px]">Make anything. Watch a real robot deal with it.</h1>
          <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.6] text-white/75">
            Lux3D turns your photo or sentence into a physical object. Unitree&apos;s published G1 walking controller has to get past it, live in
            your browser.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/arena?make=1" className="inline-flex h-11 items-center rounded-[10px] bg-target px-5 font-semibold text-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]">
              Make something
            </Link>
            <Link href="/arena" className="inline-flex h-11 items-center rounded-[10px] border border-white/25 px-5 font-semibold text-white hover:bg-white/10">
              Open the arena
            </Link>
            <a href="https://youtu.be/bBHqWoWENqU" target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-[10px] px-3 font-semibold text-white/85 hover:text-white">
              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full border border-white/40 text-[10px]">▶</span>
              Watch the film (1 min 44 s)
            </a>
          </div>
        </div>
      </div>
      {status.phase === "result" && status.result && (
        <div className="absolute right-6 top-28 sm:right-10 sm:top-24">
          <Stamp tone={status.result === "goal" ? "pass" : "fault"} animate rotate={-8} onDark className="text-[17px] !px-3 !py-1">
            {status.result === "goal" ? "Reached goal" : status.result === "fell" ? `Fell${status.on ? ` · ${status.on}` : ""}` : "Stuck"}
          </Stamp>
        </div>
      )}
    </CameraFrame>
  );
}

function HeroReadout({ status }: { status: HeroStatus }) {
  return (
    <div className="space-y-0.5 text-right [&>div]:truncate">
      <div title={status.object}>{status.object ? `OBJECT ${status.object.toUpperCase()}` : "OBJECT —"}</div>
      <div>
        {status.phase === "making"
          ? "LUX3D MATERIALIZING"
          : status.phase === "walking"
            ? "ROBOT WALKING · BLIND"
            : status.phase === "result"
              ? status.result === "goal"
                ? "ROBOT REACHED THE FLAG"
                : status.result === "fell"
                  ? "ROBOT FELL"
                  : "ROBOT TIMED OUT"
              : "LOADING"}
      </div>
      <div>{status.contacts != null ? `CONTACTS ${status.contacts}` : ""}</div>
    </div>
  );
}
