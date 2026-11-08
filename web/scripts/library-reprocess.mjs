// Re-runs processing (no Lux3D calls, no credits) for every published object from the raw GLBs kept in
// storage, rewriting visual.glb, parts.json, meta.json and the library entry. Use after process.ts changes.
//
//   node --env-file=.env.local --import tsx scripts/library-reprocess.mjs [--only id,id]
//
// Seed objects (no job) are rebuilt from dev-samples by slug.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getJob, processStored } from "../src/lib/pipeline/jobs.ts";
import { appendToLibrary, readLibrary } from "../src/lib/pipeline/library.ts";
import { processModel } from "../src/lib/pipeline/process.ts";
import { store } from "../src/lib/storage.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEEDS = { "kitchen-chair": { glb: "dev-samples/chair-parts.glb", whole: "dev-samples/chair.glb", split: true }, sneaker: { glb: "dev-samples/sneaker.glb", split: false } };
const i = process.argv.indexOf("--only");
const only = i > 0 ? process.argv[i + 1].split(",") : null;

const s = store();
const lib = await readLibrary(s);
for (const e of lib.items) {
  if (only && !only.includes(e.id) && !only.includes(e.slug)) continue;
  const meta = (await s.getJSON(`objects/${e.id}/meta.json`))?.value;
  if (!meta) continue;
  let r;
  const job = (await getJob(e.id, s))?.job;
  if (job) {
    try {
      r = await processStored(job, s);
    } catch (err) {
      console.log(`${e.slug ?? e.id}: ${err.message}, skipped`);
      continue;
    }
  } else if (SEEDS[e.slug] && existsSync(path.join(WEB, SEEDS[e.slug].glb))) {
    const sd = SEEDS[e.slug];
    r = await processModel({ glb: readFileSync(path.join(WEB, sd.glb)), split: sd.split, wholeGlb: sd.whole ? readFileSync(path.join(WEB, sd.whole)) : undefined });
    await s.put(`objects/${e.id}/visual.glb`, r.visual, { contentType: "model/gltf-binary" });
    await s.put(`objects/${e.id}/parts.json`, r.partsJson, { contentType: "application/json" });
  } else {
    console.log(`${e.slug ?? e.id}: no source, skipped`);
    continue;
  }
  const b = r.parts.bbox;
  const next = {
    ...meta,
    bbox: b,
    size: [0, 1, 2].map((k) => Math.round((b.max[k] - b.min[k]) * 1000) / 1000),
    parts: r.parts.parts.length,
    volume: r.parts.volume,
    joints: r.parts.joints?.length,
    tris: r.stats.tris,
    bytes: { visual: r.stats.visualBytes, parts: r.stats.partsBytes },
  };
  await s.putJSON(`objects/${e.id}/meta.json`, next);
  await appendToLibrary(next, s);
  console.log(`${(e.slug ?? e.id).padEnd(22)} ${next.parts} parts  ${(next.volume * 1000).toFixed(2)} L (${r.parts.parts[0].volumeMethod})  ${Math.round(r.stats.visualBytes / 1024)} KB`);
}
