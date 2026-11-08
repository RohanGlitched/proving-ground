// Copies the local library (web/.data) into the GCS bucket so production serves it.
//
//   GCS_BUCKET=<bucket> GCS_AUTH=gcloud node --import tsx scripts/library-sync.mjs [--dry]
//
// Copies objects/**, inputs/** (published objects only) and merges library.json entries by id. Never
// touches jobs, queue or limits in the bucket. GCS_AUTH=gcloud uses `gcloud auth print-access-token`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gcsStore, localStore, updateJSON } from "../src/lib/storage.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry");
const bucket = process.env.GCS_BUCKET;
if (!bucket) {
  console.error("Set GCS_BUCKET (and GCS_AUTH=gcloud or GCS_ACCESS_TOKEN).");
  process.exit(1);
}
const src = localStore(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(WEB, ".data"));
const dst = gcsStore(bucket);

const lib = (await src.getJSON("library.json"))?.value ?? { items: [] };
// comparison copies (slug suffix -g1 etc.) stay local
lib.items = lib.items.filter((e) => !/-g1$/.test(e.slug ?? ""));
const remote = new Set(await dst.list("objects/"));
let copied = 0;
for (const e of lib.items) {
  const keys = (await src.list(`objects/${e.id}/`)).concat(e.hasInput ? [`inputs/${e.id}.jpg`] : []);
  for (const k of keys) {
    // small JSON files are always refreshed (reprocessing adds fields); big files only when missing
    if (remote.has(k) && !k.endsWith(".json")) continue;
    const g = await src.get(k);
    if (!g) continue;
    if (!dry) await dst.put(k, g.body, { contentType: g.contentType });
    copied++;
    console.log(`${dry ? "would copy" : "copied"} ${k} (${Math.round(g.body.length / 1024)} KB)`);
  }
}
if (!dry)
  await updateJSON(dst, "library.json", () => ({ items: [], updatedAt: 0 }), (doc) => {
    for (const e of lib.items) {
      const i = doc.items.findIndex((x) => x.id === e.id || (e.slug && x.slug === e.slug));
      if (i >= 0) doc.items[i] = e;
      else doc.items.push(e);
    }
    doc.updatedAt = Date.now();
    return doc;
  });
console.log(`${copied} files ${dry ? "to copy" : "copied"}; ${lib.items.length} library entries ${dry ? "would be merged" : "merged"} into gs://${bucket}/library.json`);
