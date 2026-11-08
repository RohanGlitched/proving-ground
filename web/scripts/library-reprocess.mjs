// Re-runs processing (no Lux3D calls, no credits) for every published object from the raw GLBs kept in
// storage, rewriting visual.glb, parts.json, meta.json and the library entry. Use after process.ts changes.
//
//   node --env-file=.env.local --import tsx scripts/library-reprocess.mjs [--only id,id]
//
// Seed objects (no job) are rebuilt from dev-samples by slug.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getJob } from "../src/lib/pipeline/jobs.ts";
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
  let input;
  const job = (await getJob(e.id, s))?.job;
  if (job) {
    const key = job.kind === "object" ? (job.work.splitKey ?? job.work.genKey) : job.work.finalKey;
    const g = key && (await s.get(key));
    if (!g) {
      console.log(`${e.slug ?? e.id}: raw GLB missing, skipped`);
      continue;
    }
    const whole = job.kind === "object" && job.work.splitKey ? (await s.get(job.work.genKey))?.body : undefined;
    input = { glb: g.body, split: job.kind === "object" && !!job.work.splitKey, animated: job.kind !== "object", inPlace: job.kind === "pedestrian" ? true : undefined, clipName: job.kind === "pedestrian" ? "Walk_Loop" : undefined, wholeGlb: whole };
  } else if (SEEDS[e.slug] && existsSync(path.join(WEB, SEEDS[e.slug].glb))) {
    const sd = SEEDS[e.slug];
    input = { glb: readFileSync(path.join(WEB, sd.glb)), split: sd.split, wholeGlb: sd.whole ? readFileSync(path.join(WEB, sd.whole)) : undefined };
  } else {
    console.log(`${e.slug ?? e.id}: no source, skipped`);
    continue;
  }
  const r = await processModel(input);
  await s.put(`objects/${e.id}/visual.glb`, r.visual, { contentType: "model/gltf-binary" });
  await s.put(`objects/${e.id}/parts.json`, r.partsJson, { contentType: "application/json" });
  const b = r.parts.bbox;
  const next = {
    ...meta,
    bbox: b,
    size: [0, 1, 2].map((k) => Math.round((b.max[k] - b.min[k]) * 1000) / 1000),
    parts: r.parts.parts.length,
    volume: r.parts.volume,
    tris: r.stats.tris,
    bytes: { visual: r.stats.visualBytes, parts: r.stats.partsBytes },
  };
  await s.putJSON(`objects/${e.id}/meta.json`, next);
  await appendToLibrary(next, s);
  console.log(`${(e.slug ?? e.id).padEnd(22)} ${next.parts} parts  ${(next.volume * 1000).toFixed(2)} L (${r.parts.parts[0].volumeMethod})  ${Math.round(r.stats.visualBytes / 1024)} KB`);
}
