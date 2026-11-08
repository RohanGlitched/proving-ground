import { test } from "node:test";
import assert from "node:assert/strict";
import { decimateForHull, gltfIO, LIMITS, measureGlb, processModel, triangleCount } from "../../src/lib/pipeline/process.ts";
import { hasSamples, readSample } from "./helpers.mjs";

const skip = !hasSamples() && "dev-samples missing";

async function sceneNodeNames(buf) {
  const io = await gltfIO();
  const doc = await io.readBinary(new Uint8Array(buf));
  return { doc, names: doc.getRoot().listScenes()[0].listChildren().map((n) => n.getName()) };
}

test("chair-parts.glb: 8 parts, visual nodes match parts.json order, size and triangle targets", { skip }, async () => {
  const r = await processModel({ glb: readSample("chair-parts.glb"), split: true });
  assert.equal(r.parts.parts.length, 8);
  assert.equal(r.parts.source, "part-split");
  assert.equal(r.parts.up, "y");
  assert.ok(r.stats.visualBytes <= LIMITS.targetBytes, `visual ${r.stats.visualBytes} B`);
  assert.ok(r.stats.tris <= LIMITS.maxTris);
  const { doc, names } = await sceneNodeNames(r.visual);
  assert.deepEqual(names, r.parts.parts.map((p) => p.name));
  assert.deepEqual(names, Array.from({ length: 8 }, (_, i) => `part-${i}`));
  const ext = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
  assert.ok(ext.includes("EXT_meshopt_compression") && ext.includes("EXT_texture_webp"));
  for (const t of doc.getRoot().listTextures()) assert.ok(Math.max(...t.getSize()) <= 1024);
  for (const p of r.parts.parts) {
    assert.ok(p.count <= LIMITS.maxPartPoints && p.count >= 4);
    assert.equal(p.points.length, p.count * 3);
  }
});

test("chair-parts.glb: bbox matches the geometry and the Lux3D metric size (48 × 85 × 45 cm)", { skip }, async () => {
  const r = await processModel({ glb: readSample("chair-parts.glb"), split: true });
  const size = [0, 1, 2].map((k) => r.parts.bbox.max[k] - r.parts.bbox.min[k]);
  assert.ok(Math.abs(size[0] - 0.4825) < 0.005, `x ${size[0]}`);
  assert.ok(Math.abs(size[1] - 0.85) < 0.005, `y (height) ${size[1]}`);
  assert.ok(Math.abs(size[2] - 0.4456) < 0.005, `z ${size[2]}`);
  // every part's points lie inside the object bbox
  for (const p of r.parts.parts)
    for (let i = 0; i < p.points.length; i += 3)
      for (let k = 0; k < 3; k++) {
        assert.ok(p.points[i + k] >= r.parts.bbox.min[k] - 1e-3 && p.points[i + k] <= r.parts.bbox.max[k] + 1e-3);
      }
  // the measured bbox agrees with the raw whole-mesh GLB
  const m = await measureGlb(readSample("chair.glb"));
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(m.bbox.max[k] - r.parts.bbox.max[k]) < 0.002);
});

test("sneaker.glb (305k triangles, 19 MB): one part, ≤25k triangles, ≤1.5 MB", { skip }, async () => {
  const input = readSample("sneaker.glb");
  const r = await processModel({ glb: input, split: false });
  assert.equal(r.parts.parts.length, 1);
  assert.equal(r.parts.source, "whole");
  assert.ok(r.stats.trisIn > 300_000);
  assert.ok(r.stats.tris <= LIMITS.maxTris, `tris ${r.stats.tris}`);
  assert.ok(r.stats.visualBytes <= LIMITS.targetBytes, `visual ${r.stats.visualBytes}`);
  assert.equal(r.parts.parts[0].count, LIMITS.maxPartPoints);
  const { doc, names } = await sceneNodeNames(r.visual);
  assert.deepEqual(names, ["part-0"]);
  assert.ok(triangleCount(doc) <= LIMITS.maxTris);
  const size = [0, 1, 2].map((k) => r.parts.bbox.max[k] - r.parts.bbox.min[k]);
  assert.ok(Math.abs(size[0] - 0.28) < 0.005 && Math.abs(size[1] - 0.1086) < 0.005, `size ${size}`);
});

test("decimateForHull keeps the extremes of a point cloud", () => {
  const pts = [];
  for (let i = 0; i < 5000; i++) pts.push(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  pts.push(5, 0, 0, -5, 0, 0, 0, 5, 0);
  const out = decimateForHull(pts, 100);
  assert.ok(out.length / 3 <= 100);
  const has = (x, y, z) => out.some((_, i) => i % 3 === 0 && out[i] === x && out[i + 1] === y && out[i + 2] === z);
  assert.ok(has(5, 0, 0) && has(-5, 0, 0) && has(0, 5, 0));
});

test("volumes: closed whole mesh measured directly; split parts share it out", { skip }, async () => {
  const whole = await processModel({ glb: readSample("chair.glb"), split: false });
  assert.equal(whole.parts.parts[0].volumeMethod, "mesh");
  assert.ok(whole.parts.volume > 0.010 && whole.parts.volume < 0.016, `chair ${whole.parts.volume} m3`);
  const split = await processModel({ glb: readSample("chair-parts.glb"), split: true, wholeGlb: readSample("chair.glb") });
  assert.ok(split.parts.parts.every((p) => p.volumeMethod === "mesh-share"));
  assert.ok(Math.abs(split.parts.volume - whole.parts.volume) / whole.parts.volume < 0.01);
  const noWhole = await processModel({ glb: readSample("chair-parts.glb"), split: true });
  for (const p of noWhole.parts.parts) assert.ok(p.volumeMethod === "mesh" || Math.abs(p.volume - 0.6 * p.hullVolume) < 1e-6);
});
