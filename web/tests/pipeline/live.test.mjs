import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { AholoClient } from "../../src/lib/pipeline/aholo.ts";

// Opt-in: LIVE_LUX=1 (needs AHOLO_API_KEY). Costs nothing: reads the balance and uploads a tiny image
// through Asset/OUS. LIVE_LUX_GENERATE=1 also runs one image-to-3D Turbo task (1 credit, ~80 s).
const live = process.env.LIVE_LUX === "1" && !!process.env.AHOLO_API_KEY;

test("live: balance and an OUS upload", { skip: !live && "set LIVE_LUX=1" }, async () => {
  const c = new AholoClient();
  const { credits } = await c.balance();
  assert.ok(credits > 0, "balance readable");
  const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}` } })
    .png()
    .toBuffer();
  const url = await c.upload(png, "smoke.png");
  assert.match(url, /^https?:\/\//);
});

test("live: one image-to-3D Turbo task", { skip: !(live && process.env.LIVE_LUX_GENERATE === "1") && "set LIVE_LUX_GENERATE=1", timeout: 300_000 }, async () => {
  const c = new AholoClient();
  const img = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#ffffff" } })
    .composite([{ input: await sharp({ create: { width: 200, height: 300, channels: 3, background: "#d02020" } }).png().toBuffer(), left: 156, top: 106 }])
    .png()
    .toBuffer();
  const url = await c.upload(img, "box.png");
  const id = await c.createTask({ op: "img-to-3d", img: url, version: "G1-Turbo", faceCount: 10000 });
  let t;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    t = await c.getTask(id);
    if (t.status !== "running") break;
  }
  assert.equal(t.status, "done");
  assert.ok(t.outputs.some((o) => o.isUrl));
});
