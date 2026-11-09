"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Stamp } from "@/components/ui/marks";
import { CHALLENGES, bestOf, challengeHref, scoreLabel } from "@/lib/challenges";

const KIND = { fix: "Fix it", trip: "Trip it", steer: "Steer it" } as const;

/** The challenge cards: what to do, the limit, par, and this browser's best. */
export function ChallengeList() {
  const [best, setBest] = useState<Record<string, number | null>>({});
  useEffect(() => {
    setBest(Object.fromEntries(CHALLENGES.map((c) => [c.id, bestOf(c.id)])));
  }, []);
  const done = Object.values(best).filter((v) => v != null).length;
  return (
    <section id="challenges" className="mt-12 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="placard-sm text-[27px] sm:text-[31px]">Challenges</h2>
          <p className="mt-2 max-w-2xl text-[16px] leading-[1.65] text-ink-2">
            A goal, a limit and a score. Fix a course by moving as little as possible, trip the robot with as little mass as possible, or take the
            keys and walk it home yourself. Every check runs the same physics as everything else here.
          </p>
        </div>
        <div className="data text-[13px] text-ink-3">
          {done} of {CHALLENGES.length} cleared in this browser
        </div>
      </div>
      <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {CHALLENGES.map((c) => {
          const b = best[c.id];
          return (
            <li key={c.id}>
              <Link href={challengeHref(c)} className="sheet group relative flex h-full flex-col p-5 transition-transform hover:-translate-y-0.5">
                <span className="data text-[12px] text-ink-3">{KIND[c.kind]}</span>
                <h3 className="mt-2 text-[18px] font-semibold leading-snug">{c.title}</h3>
                <p className="mt-2 flex-1 text-[14px] leading-[1.55] text-ink-2">{c.brief}</p>
                <div className="mt-4 flex items-end justify-between gap-2">
                  <div className="text-[12.5px] text-ink-3">
                    {c.par && <div>Par {c.par}</div>}
                    <div>{b != null ? `Your best ${scoreLabel(c, b)}` : "Not cleared yet"}</div>
                  </div>
                  {b != null && (
                    <Stamp tone="pass" rotate={-6}>
                      Cleared
                    </Stamp>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
