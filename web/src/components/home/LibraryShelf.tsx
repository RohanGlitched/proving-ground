"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getLibrary, type LibraryEntry } from "@/lib/client/api";
import { Thumb } from "@/components/arena/Thumb";
import { sizeLabel } from "@/components/arena/LibraryDrawer";
import { Stamp } from "@/components/ui/marks";
import { tripIndex, verdict, type TripResult } from "@/lib/client/trips";

export function LibraryShelf() {
  const [items, setItems] = useState<LibraryEntry[] | null>(null);
  const [trips, setTrips] = useState<Record<string, TripResult>>({});
  useEffect(() => {
    tripIndex().then(setTrips);
  }, []);
  useEffect(() => {
    getLibrary()
      .then((x) => setItems(x.filter((e) => e.kind === "object").sort((a, b) => b.parts - a.parts || b.createdAt - a.createdAt)))
      .catch(() => setItems([]));
  }, []);
  return (
    <div className="mx-auto mt-8 max-w-[1400px] px-4 sm:px-6">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {items == null &&
          Array.from({ length: 12 }, (_, i) => (
            <li key={i} className="sheet aspect-[3/4] animate-pulse" />
          ))}
        {items?.slice(0, 12).map((e) => (
          <li key={e.id}>
            <Link href={`/arena?add=${e.id}`} className="sheet group block overflow-hidden transition-transform hover:-translate-y-0.5" title={`Test ${e.name} in the arena`}>
              <div className="relative">
                <Thumb id={e.id} alt={e.name} size={e.size} eager className="aspect-square" />
                {trips[e.id] && (
                  <Stamp tone={verdict(trips[e.id]).tone} rotate={-6} className="absolute bottom-2 right-2 bg-paper/85 !px-1.5 !text-[10px]">
                    {verdict(trips[e.id]).label}
                  </Stamp>
                )}
              </div>
              <div className="border-t border-ink/8 px-3 py-2">
                <div className="truncate text-[14px] font-semibold">{e.name}</div>
                <div className="data truncate text-[11px] text-ink-3">
                  {sizeLabel(e.size)} · {e.parts}p
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {items && items.length === 0 && <p className="text-ink-3">The library fills up as people make things. Be the first.</p>}
    </div>
  );
}
