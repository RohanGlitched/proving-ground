"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getJob, getLibrary, objectUrl, type LibraryEntry } from "@/lib/client/api";
import { Thumb } from "@/components/arena/Thumb";
import { sizeLabel } from "@/components/arena/LibraryDrawer";
import { ObjectViewer } from "./ObjectViewer";
import { Stamp } from "@/components/ui/marks";

type Sort = "new" | "big" | "parts";

export function LibraryBrowser() {
  const [items, setItems] = useState<LibraryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<Sort>("new");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LibraryEntry | null>(null);
  const [packing, setPacking] = useState(false);
  const [packMsg, setPackMsg] = useState<string | null>(null);

  useEffect(() => {
    getLibrary()
      .then(setItems)
      .catch((e) => setErr((e as Error).message));
  }, []);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  const cats = useMemo(() => ["all", ...Array.from(new Set((items ?? []).map((i) => i.category ?? "made by people"))).sort()], [items]);
  const shown = useMemo(() => {
    const list = (items ?? [])
      .filter((i) => cat === "all" || (i.category ?? "made by people") === cat)
      .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()));
    const vol = (e: LibraryEntry) => e.size[0] * e.size[1] * e.size[2];
    return list.sort((a, b) => (sort === "new" ? b.createdAt - a.createdAt : sort === "big" ? vol(b) - vol(a) : b.parts - a.parts));
  }, [items, cat, q, sort]);

  const [exporting, setExporting] = useState<string | null>(null);
  async function exportAs(e: LibraryEntry, format: string) {
    setExporting(format);
    setPackMsg(null);
    try {
      const r = await fetch(`/api/objects/${e.id}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format }) });
      const d = (await r.json().catch(() => ({}))) as { status?: string; url?: string; jobId?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Export is not available right now");
      let url = d.url;
      if (!url && d.jobId) {
        setPackMsg("Lux3D is converting it. This takes under a minute.");
        for (let i = 0; i < 60 && !url; i++) {
          await new Promise((res) => setTimeout(res, 4000));
          const j = await getJob(d.jobId);
          if (j.status === "failed") throw new Error(j.error ?? "Lux3D could not convert it");
          if (j.status === "done") url = `/api/objects/${e.id}/export/${format}`;
        }
      }
      if (!url) throw new Error("The conversion is taking longer than usual; try again in a minute");
      const a = document.createElement("a");
      a.href = url;
      a.click();
      setPackMsg(`Downloaded ${format.replace("_zip", "").toUpperCase()} from Lux3D's exporter.`);
    } catch (x) {
      setPackMsg((x as Error).message);
    } finally {
      setExporting(null);
    }
  }

  async function pack(e: LibraryEntry) {
    setPacking(true);
    setPackMsg(null);
    try {
      const { buildPack } = await import("@/lib/client/pack");
      const r = await buildPack(e);
      setPackMsg(`Downloaded: ${r.parts} hull${r.parts === 1 ? "" : "s"}, ${r.mass.toFixed(2)} kg at 400 kg/m³.`);
    } catch (x) {
      setPackMsg(`Could not build the pack: ${(x as Error).message}`);
    } finally {
      setPacking(false);
    }
  }

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          aria-label="Search the library"
          className="h-10 w-full rounded-[10px] border border-ink/15 bg-paper px-3 text-[15px] outline-none focus:border-route sm:w-64"
        />
        <div className="flex gap-1.5 overflow-x-auto text-[13px]">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`shrink-0 rounded-full px-3 py-1.5 ${cat === c ? "bg-ink text-white" : "border border-ink/15 text-ink-2 hover:border-ink/30"}`}>
              {c}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-[13.5px] text-ink-2">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-[8px] border border-ink/15 bg-paper px-2">
            <option value="new">Newest</option>
            <option value="big">Largest</option>
            <option value="parts">Most parts</option>
          </select>
        </label>
      </div>

      {err && <p className="mt-8 text-fault">The library could not be loaded: {err}</p>}
      {!items && !err && (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="sheet aspect-[4/5] animate-pulse" />
          ))}
        </div>
      )}
      {items && shown.length === 0 && (
        <div className="mt-10 rounded-[3px] border border-dashed border-ink/25 p-8 text-center">
          <p className="text-[16px]">{items.length ? "Nothing matches that." : "Nothing here yet."}</p>
          <Link href="/arena?make=1" className="mt-4 inline-flex h-10 items-center rounded-[10px] bg-target px-4 font-semibold">
            Make the first one
          </Link>
        </div>
      )}
      <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((e) => (
          <li key={e.id}>
            <button onClick={() => setOpen(e)} className="sheet group block w-full overflow-hidden text-left transition-transform hover:-translate-y-0.5">
              <Thumb id={e.id} alt={e.name} className="aspect-square" />
              <div className="border-t border-ink/8 px-3 py-2.5">
                <div className="truncate font-semibold">{e.name}</div>
                <div className="data mt-0.5 truncate text-[11.5px] text-ink-3">{sizeLabel(e.size)}</div>
                <div className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-3">
                  <span>{e.parts} {e.parts === 1 ? "part" : "parts"}</span>
                  <span aria-hidden>·</span>
                  <span>{e.source === "photo" ? "from a photo" : e.source === "text" ? "from a sentence" : "library"}</span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/50 backdrop-blur-sm md:items-center md:justify-center" role="dialog" aria-modal aria-label={open.name} onClick={() => setOpen(null)}>
          <div className="max-h-[92svh] w-full overflow-y-auto bg-concrete md:max-w-5xl md:rounded-[4px]" onClick={(ev) => ev.stopPropagation()}>
            <div className="grid md:grid-cols-[1.4fr_1fr]">
              <div className="h-[46svh] p-3 md:h-[560px]">
                <ObjectViewer url={objectUrl(open.id, "visual.glb")} label={open.name} />
              </div>
              <div className="p-5 md:p-7">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="placard-sm text-[25px]">{open.name}</h2>
                  <button onClick={() => setOpen(null)} className="rounded-[8px] px-2 py-1 text-[14px] text-ink-3 hover:bg-ink/5" aria-label="Close">
                    Close
                  </button>
                </div>
                <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14.5px]">
                  <dt className="text-ink-3">Size</dt>
                  <dd className="tnum">{sizeLabel(open.size)}</dd>
                  <dt className="text-ink-3">Parts</dt>
                  <dd className="tnum">{open.parts} convex {open.parts === 1 ? "solid" : "solids"}</dd>
                  <dt className="text-ink-3">Made from</dt>
                  <dd>{open.source === "photo" ? "a photo" : open.source === "text" ? "a sentence" : "the starter library"}</dd>
                  {open.style && (
                    <>
                      <dt className="text-ink-3">Look</dt>
                      <dd>{open.style.replace("_", " ")}</dd>
                    </>
                  )}
                  <dt className="text-ink-3">Made</dt>
                  <dd>{new Date(open.createdAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</dd>
                </dl>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href={`/arena?add=${open.id}`} className="inline-flex h-11 items-center rounded-[10px] bg-target px-5 font-semibold shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]">
                    Test it in the arena
                  </Link>
                  <button onClick={() => pack(open)} disabled={packing} className="inline-flex h-11 items-center rounded-[10px] border border-ink/20 px-5 font-semibold hover:bg-ink/5 disabled:opacity-50">
                    {packing ? "Building the pack…" : "Download robot-ready pack"}
                  </button>
                </div>
                <div className="mt-4">
                  <div className="text-[13px] font-semibold text-ink-3">Export with Lux3D</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      ["stl", "STL for 3D printing"],
                      ["3mf", "3MF"],
                      ["usdz", "USDZ"],
                      ["fbx_zip", "FBX"],
                    ].map(([f, label]) => (
                      <button
                        key={f}
                        onClick={() => exportAs(open, f)}
                        disabled={!!exporting}
                        className="h-9 rounded-[8px] border border-ink/15 px-3 text-[13px] font-semibold hover:bg-ink/5 disabled:opacity-50"
                      >
                        {exporting === f ? "Converting…" : label}
                      </button>
                    ))}
                  </div>
                </div>
                {packMsg && <p className="mt-3 text-[13.5px] text-ink-2">{packMsg}</p>}
                <p className="mt-6 text-[13.5px] leading-relaxed text-ink-3">
                  The pack has the textured GLB, one STL hull per part and a MuJoCo body with masses. It is the exact data the arena&apos;s physics uses.
                </p>
                <div className="mt-5">
                  <Stamp tone="route" rotate={-3}>
                    Lux3D · {open.parts > 1 ? "part-split" : "single part"}
                  </Stamp>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
