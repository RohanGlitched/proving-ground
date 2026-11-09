"use client";
import type { TrialSummary } from "@/sim/types";
import { Stamp, Target } from "@/components/ui/marks";

export function ResultsSheet({
  summary,
  running,
  names,
  mode,
  onReplay,
  replaying = null,
}: {
  summary: TrialSummary | null;
  running: number | null;
  names: Record<string, string>;
  mode: string;
  onReplay?: (i: number) => void;
  replaying?: number | null;
}) {
  if (!summary && running == null) {
    return (
      <div className="rounded-[3px] border border-dashed border-ink/20 p-4 text-[13.5px] text-ink-3">
        <strong className="text-ink-2">Run 10 trials</strong> to test the course: ten seeded walks, each starting a little off-line. You get a pass rate and what the robot
        tripped on.
      </div>
    );
  }
  const slots = Array.from({ length: 10 }, (_, i) => summary?.trials[i] ?? null);
  const causes = new Map<string, number>();
  summary?.trials.forEach((t) => {
    if (t.result === "fell" && t.fallCause) causes.set(t.fallCause, (causes.get(t.fallCause) ?? 0) + 1);
  });
  const pct = summary ? Math.round(summary.passRate * 100) : null;
  return (
    <div className="sheet relative overflow-hidden p-4">
      <Target size={18} className="absolute right-3 top-3 opacity-80" />
      <div className="text-[12.5px] font-semibold text-ink-3">Test report · {mode === "planner" ? "planner" : "blind walk"}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="data text-[39px] leading-none">{pct == null ? "…" : `${pct}%`}</span>
        <span className="text-[13px] text-ink-2">reached the goal</span>
      </div>
      <ol className="mt-3 grid grid-cols-5 gap-1.5" aria-label="Runs">
        {slots.map((t, i) => (
          <li key={i}>
            <button
              disabled={!t || !onReplay || replaying != null}
              onClick={() => onReplay?.(i)}
              title={t ? `Replay run ${i + 1} exactly` : undefined}
              className={`flex aspect-square w-full flex-col items-center justify-center rounded-[3px] text-center transition-colors ${
                replaying === i ? "bg-target/40 ring-2 ring-target" : "bg-ink/[0.04] enabled:hover:bg-ink/[0.09]"
              }`}
            >
            <span className="data text-[9.5px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
            {t ? (
              <span className={`text-[11px] font-extrabold uppercase ${t.result === "goal" ? "text-pass" : t.result === "fell" ? "text-fault" : "text-ink-3"}`}>
                {t.result === "goal" ? "pass" : t.result === "fell" ? "fell" : "stuck"}
              </span>
            ) : (
              <span className={`h-2 w-2 rounded-full ${running != null && i === running ? "animate-pulse bg-target" : "bg-ink/15"}`} />
            )}
            </button>
          </li>
        ))}
      </ol>
      {summary && (
        <div className="mt-3 space-y-1 text-[13px]">
          {summary.meanTimeToGoal != null && (
            <div>
              Average time to goal <span className="tnum font-semibold">{summary.meanTimeToGoal.toFixed(1)} s</span>
            </div>
          )}
          {[...causes.entries()].map(([id, n]) => (
            <div key={id} className="text-fault">
              Tripped on {names[id] ?? id} {n > 1 ? `· ${n} times` : ""}
            </div>
          ))}
          {onReplay && <div className="text-[12px] text-ink-3">Click a run to replay it exactly, shove and all.</div>}
          <div className="pt-2">
            <Stamp tone={summary.passRate >= 0.8 ? "pass" : summary.passRate >= 0.4 ? "ink" : "fault"} animate rotate={-4}>
              {summary.passRate >= 0.8 ? "Course cleared" : summary.passRate >= 0.4 ? "Shaky" : "Robot defeated"}
            </Stamp>
          </div>
        </div>
      )}
    </div>
  );
}
