// Adds the two models generated during the Nov 9 probes to the library at no credit cost:
// a kitchen chair (Lux3D text-to-3D Turbo "a wooden chair" + part-split, 8 parts) and a sneaker (image-to-3D
// Turbo from probe/in/sneaker.png). Skips a slug that is already in the library.
//
//   node --env-file=.env.local --import tsx scripts/library-seed.mjs
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "../src/lib/pipeline/config.ts";
import { appendToLibrary, readLibrary } from "../src/lib/pipeline/library.ts";
import { processModel } from "../src/lib/pipeline/process.ts";
import { cleanImage } from "../src/lib/pipeline/validate.ts";
import { store } from "../src/lib/storage.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seeds = [
  {
    slug: "kitchen-chair",
    name: "Kitchen chair",
    category: "household",
    source: "library",
    prompt: "a wooden chair",
    style: "photorealistic",
    glb: "dev-samples/chair-parts.glb",
    split: true,
    credits: 43,
    lux3dTasks: { generate: "4932836", "part-split": "4932893" },
  },
  {
    slug: "sneaker",
    name: "Sneaker",
    category: "odd",
    source: "photo",
    glb: "dev-samples/sneaker.glb",
    image: "../../probe/in/sneaker.png",
    split: false,
    credits: 1,
    lux3dTasks: {},
  },
];

const s = store();
const lib = await readLibrary(s);
for (const seed of seeds) {
  if (lib.items.some((i) => i.slug === seed.slug)) {
    console.log(`${seed.slug}: already in the library`);
    continue;
  }
  const file = path.join(WEB, seed.glb);
  if (!existsSync(file)) {
    console.log(`${seed.slug}: ${seed.glb} missing, skipped`);
    continue;
  }
  const id = newId();
  const r = await processModel({ glb: readFileSync(file), split: seed.split });
  await s.put(`objects/${id}/visual.glb`, r.visual, { contentType: "model/gltf-binary" });
  await s.put(`objects/${id}/parts.json`, r.partsJson, { contentType: "application/json" });
  let hasInput = false;
  if (seed.image && existsSync(path.join(WEB, seed.image))) {
    const { jpeg } = await cleanImage(readFileSync(path.join(WEB, seed.image)));
    await s.put(`inputs/${id}.jpg`, jpeg, { contentType: "image/jpeg" });
    hasInput = true;
  }
  const b = r.parts.bbox;
  const meta = {
    id,
    slug: seed.slug,
    name: seed.name,
    kind: "object",
    source: seed.source,
    category: seed.category,
    prompt: seed.prompt,
    style: seed.style,
    version: "G1-Turbo",
    up: "y",
    unit: "m",
    bbox: b,
    size: [0, 1, 2].map((k) => Math.round((b.max[k] - b.min[k]) * 1000) / 1000),
    parts: r.parts.parts.length,
    split: r.parts.source === "part-split" ? "parts" : "whole",
    tris: r.stats.tris,
    bytes: { visual: r.stats.visualBytes, parts: r.stats.partsBytes },
    hasInput,
    createdAt: Date.now(),
    credits: seed.credits,
    lux3dTasks: seed.lux3dTasks,
  };
  await s.putJSON(`objects/${id}/meta.json`, meta);
  await appendToLibrary(meta, s);
  console.log(`${seed.slug}: ${id}, ${meta.parts} parts, ${Math.round(r.stats.visualBytes / 1024)} KB, size ${meta.size.join(" × ")} m`);
}
