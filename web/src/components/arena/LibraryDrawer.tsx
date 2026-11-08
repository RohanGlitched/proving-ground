"use client";
import { useMemo, useState } from "react";
import type { LibraryEntry } from "@/lib/client/api";
import { Thumb } from "./Thumb";

export const cm = (m: number) => Math.round(m * 100);
export const sizeLabel = (s: [number, number, number], kind?: string) => (kind === "pedestrian" ? `${cm(s[1])} cm tall` : `${cm(s[0])} × ${cm(s[2])} × ${cm(s[1])} cm`);

export function LibraryDrawer({ items, loading, onAdd }: { items: LibraryEntry[]; loading: boolean; onAdd: (e: LibraryEntry) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const cats = useMemo(() => ["all", ...Array.from(new Set(items.map((i) => i.category ?? "made by people"))).sort()], [items]);
  const shown = items
    .filter((i) => i.kind === "object" || i.kind === "articulated")
    .filter((i) => cat === "all" || (i.category ?? "made by people") === cat)
    .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the library"
        className="h-10 w-full rounded-[10px] border border-ink/15 bg-paper px-3 text-[14px] outline-none focus:border-route"
      />
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 text-[12.5px]">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`shrink-0 rounded-full px-2.5 py-1 ${cat === c ? "bg-ink text-white" : "border border-ink/12 text-ink-2 hover:border-ink/30"}`}
          >
            {c}
          </button>
        ))}
      </div>
      {items.some((i) => i.kind === "pedestrian") && (
        <div className="mt-2 rounded-[3px] bg-ink/[0.04] p-2">
          <div className="text-[12px] font-semibold text-ink-3">People who walk through (Lux3D rig + walk cycle)</div>
          <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
            {items
              .filter((i) => i.kind === "pedestrian")
              .map((e) => (
                <button key={e.id} onClick={() => onAdd(e)} className="shrink-0 rounded-[8px] border border-ink/15 bg-paper px-2.5 py-1.5 text-[12.5px] font-semibold hover:border-ink/40" title={`Add ${e.name} walking across the course`}>
                  + {e.name}
                </button>
              ))}
          </div>
        </div>
      )}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        {loading && <div className="grid grid-cols-2 gap-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sheet aspect-square animate-pulse" />)}</div>}
        {!loading && shown.length === 0 && (
          <p className="px-1 py-6 text-[14px] text-ink-3">{items.length ? "Nothing matches. Try another word, or make it." : "The library is empty. Make the first object."}</p>
        )}
        <ul className="grid grid-cols-2 gap-2">
          {shown.map((e) => (
            <li key={e.id}>
              <button onClick={() => onAdd(e)} className="sheet group block w-full overflow-hidden text-left transition-transform hover:-translate-y-0.5" title={`Add ${e.name} to the arena`}>
                <Thumb id={e.id} alt={e.name} className="aspect-square" />
                <div className="px-2.5 py-2">
                  <div className="truncate text-[13.5px] font-semibold">{e.name}</div>
                  <div className="data truncate text-[11px] text-ink-3">
                    {sizeLabel(e.size)} · {e.parts} {e.parts === 1 ? "part" : "parts"}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
