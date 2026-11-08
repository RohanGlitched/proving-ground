"use client";
// Ten seeded runs of one course, side by side. Until the sim is wired this shows the designed
// empty state; the real version streams results from the trials worker.
import { Stamp } from "@/components/ui/marks";

export function TrialWall() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="relative aspect-[4/3] overflow-hidden rounded-[3px] bg-cam">
          <span className="data absolute left-2 top-1.5 text-[10px] text-white/60">RUN {String(i + 1).padStart(2, "0")}</span>
          <div className="absolute inset-0 grid place-items-center">
            <Stamp tone="ink" rotate={-4} className="border-white/30 text-white/30">
              Waiting
            </Stamp>
          </div>
        </div>
      ))}
    </div>
  );
}
