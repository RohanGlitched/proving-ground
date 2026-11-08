"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { listCourses } from "@/lib/client/api";
import { Stamp, Target } from "@/components/ui/marks";

type Item = Awaited<ReturnType<typeof listCourses>>["items"][number];

export function CourseList({ limit, compact = false }: { limit?: number; compact?: boolean }) {
  const [sort, setSort] = useState<"hardest" | "new">("hardest");
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setItems(null);
    listCourses(sort)
      .then((d) => setItems(d.items))
      .catch(() => setErr(true));
  }, [sort]);

  const shown = (items ?? []).slice(0, limit ?? 60);
  return (
    <div className="mt-8">
      {!compact && (
        <div className="mb-6 flex gap-1 rounded-[10px] bg-ink/[0.06] p-1 text-[14px] font-semibold sm:w-fit">
          {(["hardest", "new"] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={`h-9 flex-1 whitespace-nowrap rounded-[8px] px-4 ${sort === s ? "bg-paper shadow-sm" : "text-ink-3"}`}>
              {s === "hardest" ? "Hardest first" : "Newest first"}
            </button>
          ))}
        </div>
      )}
      {err && <p className="text-fault">Courses could not be loaded right now.</p>}
      {!items && !err && (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: limit ?? 6 }, (_, i) => (
            <div key={i} className="sheet h-48 animate-pulse" />
          ))}
        </div>
      )}
      {items && shown.length === 0 && (
        <div className="rounded-[3px] border border-dashed border-ink/25 p-8 text-center">
          <p>No courses yet. Build one from your own things and see if the robot survives it.</p>
          <Link href="/arena" className="mt-4 inline-flex h-10 items-center rounded-[10px] bg-target px-4 font-semibold">
            Build a course
          </Link>
        </div>
      )}
      <ol className="grid gap-4 md:grid-cols-3">
        {shown.map((c, i) => {
          const rate = c.meanPassRate;
          return (
            <li key={c.id}>
              <Link href={`/c/${c.id}`} className="sheet group relative block h-full p-5 transition-transform hover:-translate-y-0.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="data text-[12px] text-ink-3">{sort === "hardest" ? `#${String(i + 1).padStart(2, "0")}` : new Date(c.createdAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
                  <Target size={18} />
                </div>
                <h3 className="mt-3 line-clamp-2 text-[18px] font-semibold leading-snug">{c.title}</h3>
                <div className="mt-2 text-[13.5px] text-ink-3">
                  {c.objects} {c.objects === 1 ? "object" : "objects"} · {c.trials} trials run
                </div>
                <div className="mt-5 flex items-end justify-between">
                  <div>
                    <div className="data text-[31px] leading-none">{rate == null ? "—" : `${Math.round(rate * 100)}%`}</div>
                    <div className="text-[12.5px] text-ink-3">robot pass rate</div>
                  </div>
                  {rate != null && (
                    <Stamp tone={rate < 0.4 ? "fault" : rate < 0.8 ? "ink" : "pass"} rotate={-6}>
                      {rate < 0.4 ? "Brutal" : rate < 0.8 ? "Tricky" : "Cleared"}
                    </Stamp>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
