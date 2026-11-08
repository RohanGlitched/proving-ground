"use client";
// The chrome of a test camera: corner brackets, timecode, frame counter, a 1 m scale bar.
// Everything here is a real readout fed by props; nothing is decorative filler.
import { useEffect, useRef } from "react";

function tc(seconds: number, fps = 60) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s % 1) * fps);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`;
}

export type CameraFrameProps = {
  label: string;
  /** called each frame to read the sim time in seconds; null hides the timecode */
  clock?: () => number | null;
  /** pixels per metre at the scale bar's depth, or null to hide it */
  pxPerMetre?: () => number | null;
  rec?: boolean;
  right?: React.ReactNode;
  bottomRight?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

export function CameraFrame({ label, clock, pxPerMetre, rec = true, right, bottomRight, className = "", children }: CameraFrameProps) {
  const tcRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    const tick = () => {
      frames++;
      const t = clock?.();
      if (tcRef.current) tcRef.current.textContent = t == null ? "--:--:--:--" : tc(t);
      if (frameRef.current) frameRef.current.textContent = String(frames).padStart(6, "0");
      const ppm = pxPerMetre?.();
      if (barRef.current) {
        if (ppm && ppm > 8 && ppm < 600) {
          barRef.current.style.width = `${ppm}px`;
          barRef.current.style.opacity = "1";
        } else barRef.current.style.opacity = "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock, pxPerMetre]);

  const corner = "absolute w-5 h-5 border-white/50 pointer-events-none";
  return (
    <div className={`relative overflow-hidden bg-cam text-white ${className}`}>
      {children}
      <div className="pointer-events-none absolute inset-0 select-none">
        <span className={`${corner} left-3 top-3 border-l border-t`} />
        <span className={`${corner} right-3 top-3 border-r border-t`} />
        <span className={`${corner} left-3 bottom-3 border-l border-b`} />
        <span className={`${corner} right-3 bottom-3 border-r border-b`} />
        <div className="data absolute left-6 top-5 flex items-center gap-3 text-[11px] text-white/80 sm:text-xs">
          {rec && <span className="rec-dot inline-block h-2 w-2 rounded-full bg-fault" aria-hidden />}
          <span>{label}</span>
          <span ref={tcRef} className="text-white/60" aria-label="sim time" />
        </div>
        <div className="data absolute right-6 top-5 text-right text-[11px] text-white/60 sm:text-xs">
          {right ?? (
            <>
              FRAME <span ref={frameRef} />
            </>
          )}
        </div>
        <div className="data absolute bottom-5 left-6 hidden items-end gap-2 text-[11px] text-white/70 sm:flex">
          <div ref={barRef} className="relative h-2 border-x border-b border-white/70 transition-[width] duration-200" style={{ width: 0, opacity: 0 }} />
          <span>1 m</span>
        </div>
        {bottomRight && <div className="data absolute bottom-5 right-6 text-[11px] text-white/70">{bottomRight}</div>}
      </div>
    </div>
  );
}
