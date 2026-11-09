import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { checkHoneypot, checkKind, checkStyle, checkText, cleanImage, isBlocked, sniffImage, MAX_IMAGE_BYTES } from "../../src/lib/pipeline/validate.ts";
import { validateCourse, validateResult } from "../../src/lib/pipeline/courses.ts";
import { mapBusinessError } from "../../src/lib/pipeline/aholo.ts";
import { hashIp, ipKey, takeCappedSlot, takeJobSlot } from "../../src/lib/pipeline/limits.ts";
import { tempStore } from "./helpers.mjs";

test("text: trimmed, length-limited, blocklisted on whole words", () => {
  assert.equal(checkText("  a   red\tstool "), "a red stool");
  assert.throws(() => checkText("x".repeat(121)), /120/);
  assert.throws(() => checkText(""), /describe/);
  assert.throws(() => checkText(42));
  assert.ok(isBlocked("a n4ked mannequin"));
  assert.ok(isBlocked("NSFW lamp"));
  assert.ok(!isBlocked("a classic Scunthorpe bus shelter"));
  assert.ok(!isBlocked("a cocktail shaker"));
  assert.throws(() => checkText("porn mag"), /isn't allowed/);
});

test("style, kind and honeypot", () => {
  assert.equal(checkStyle(undefined), "photorealistic");
  assert.equal(checkStyle("glass"), "glass");
  assert.throws(() => checkStyle("vaporwave"));
  assert.equal(checkKind(null), "object");
  assert.equal(checkKind("pedestrian"), "pedestrian");
  assert.throws(() => checkKind("robot"));
  checkHoneypot("");
  checkHoneypot(null);
  assert.throws(() => checkHoneypot("http://spam"));
});

test("images: sniffed by magic bytes, re-encoded ≤1024 px JPEG without EXIF/GPS", async () => {
  const big = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#c04020" } })
    .withExif({ IFD0: { Make: "SecretPhone", Copyright: "me" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 4/1 0/1" } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(big).metadata()).exif, "fixture has EXIF");
  const out = await cleanImage(big);
  const m = await sharp(out.jpeg).metadata();
  assert.equal(m.format, "jpeg");
  assert.equal(Math.max(m.width, m.height), 1024);
  assert.equal(m.exif, undefined, "EXIF stripped");
  const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.equal(sniffImage(png), "png");
  const fromPng = await cleanImage(png);
  assert.equal((await sharp(fromPng.jpeg).metadata()).width, 300, "small images are not enlarged");
  const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "binary");
  await assert.rejects(cleanImage(gif), /JPEG, PNG or WebP/);
  await assert.rejects(cleanImage(Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff)), /8 MB/);
  await assert.rejects(cleanImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])), /could not be read/);
});

test("courses and results are validated", () => {
  const ok = validateCourse(
    { title: "Chair maze", objects: [{ objectId: "abc123defg", name: "Kitchen chair", x: 1, y: 2, yaw: 0.3, extra: "dropped", density: 99999, kind: "mover" }], goal: { x: 3, y: 0 }, start: { x: 0, y: 0, yaw: 0 }, mode: "trials" },
    200,
  );
  assert.equal(ok.title, "Chair maze");
  assert.deepEqual(ok.objects, [{ objectId: "abc123defg", name: "Kitchen chair", x: 1, y: 2, yaw: 0.3, density: 12000, kind: "mover" }], "unknown fields stripped, density clamped");
  const far = validateCourse({ objects: [{ objectId: "abc123defg", name: "Cone", x: 900, y: -900, yaw: 0 }], goal: { x: 1e6, y: 0 } }, 100);
  assert.deepEqual([far.objects[0].x, far.objects[0].y, far.goal.x], [25, -25, 25], "positions clamped to ±25 m");
  assert.equal(validateCourse({ objects: [{ objectId: "abc123defg", x: 0, y: 0 }], goal: { x: 1, y: 0 } }, 100).objects[0].name, "Object");
  assert.throws(() => validateCourse({ objects: [{ objectId: "abc123defg", name: "x".repeat(41), x: 0, y: 0 }], goal: { x: 1, y: 0 } }, 100), /40/);
  assert.throws(() => validateCourse({ objects: [{ objectId: "abc123defg", name: "nazi cone", x: 0, y: 0 }], goal: { x: 1, y: 0 } }, 100), /isn't allowed/);
  assert.throws(() => validateCourse({ objects: [{ objectId: "abc123defg", name: 5, x: 0, y: 0 }], goal: { x: 1, y: 0 } }, 100), /name/);
  assert.throws(() => validateCourse({ objects: [{ objectId: "abc123defg", name: "Cone", x: 0, y: 0, kind: "boss" }], goal: { x: 1, y: 0 } }, 100), /kind/);
  assert.throws(() => validateCourse({ objects: [{ objectId: "abc123defg", name: "Cone", x: "1", y: 0 }], goal: { x: 1, y: 0 } }, 100), /finite/);
  assert.throws(() => validateCourse({ objects: [], goal: "there" }, 100), /goal/);
  assert.throws(() => validateCourse({ objects: [] }, 100), /goal/);
  assert.throws(() => validateCourse({ objects: [], goal: { x: 1, y: 0 }, start: { x: NaN, y: 0 } }, 100), /start/);
  assert.throws(() => validateCourse({ title: "y".repeat(61), objects: [], goal: { x: 1, y: 0 } }, 100), /60/);
  assert.throws(() => validateCourse({ objects: [] }, 60_000), /50 KB/);
  assert.throws(() => validateCourse({ objects: [{ objectId: "../x" }] }, 100), /objectId/);
  assert.throws(() => validateCourse({ objects: "nope" }, 100), /objects list/);
  assert.throws(() => validateCourse([], 10), /JSON object/);
  assert.deepEqual(validateResult({ passRate: 0.7, trials: 10, seed: 42 }), { passRate: 0.7, trials: 10, seed: 42 });
  assert.throws(() => validateResult({ passRate: 1.2, trials: 10, seed: 1 }));
  assert.throws(() => validateResult({ passRate: 0.5, trials: 0, seed: 1 }));
  assert.throws(() => validateResult({ passRate: 0.33, trials: 10, seed: 1 }), /passes/);
  assert.throws(() => validateResult({ passRate: 0.5, trials: 10, seed: -1 }));
});

test("Lux3D business errors map to safe sentences", () => {
  const e = mapBusinessError("GENERATION_CONCURRENCY_LIMIT_EXCEEDED", "only one task");
  assert.equal(e.kind, "concurrency");
  assert.ok(e.retryable);
  assert.equal(mapBusinessError("INSUFFICIENT_CREDITS", "").kind, "credits");
  assert.ok(!/key/i.test(mapBusinessError("X", "Authorization abc").message));
});

test("rate limits: 3 per IP per hour, 40 a day overall", async () => {
  const { store, cleanup } = tempStore();
  try {
    const t = Date.UTC(2026, 10, 10, 12);
    for (let i = 0; i < 3; i++) assert.equal((await takeJobSlot("ip-a", store, t + i)).ok, true);
    const fourth = await takeJobSlot("ip-a", store, t + 10);
    assert.equal(fourth.ok, false);
    assert.ok(fourth.retryAfter > 3500);
    assert.equal((await takeJobSlot("ip-a", store, t + 3600_001)).ok, true, "window rolls after an hour");
    process.env.LIMIT_PER_DAY = "6";
    for (let i = 0; i < 2; i++) assert.equal((await takeJobSlot(`ip-${i}`, store, t + 20 + i)).ok, true);
    const over = await takeJobSlot("ip-z", store, t + 30);
    assert.equal(over.ok, false);
    assert.match(over.reason, /Today/);
    assert.match(over.reason, /library of 72/);
  } finally {
    delete process.env.LIMIT_PER_DAY;
    cleanup();
  }
});

test("rate limits: 6 per IP per day even when the hour rolls", async () => {
  const { store, cleanup } = tempStore();
  try {
    const t = Date.UTC(2026, 10, 10, 1);
    for (let h = 0; h < 2; h++) for (let i = 0; i < 3; i++) assert.equal((await takeJobSlot("ip-d", store, t + h * 3700_000 + i)).ok, true);
    const seventh = await takeJobSlot("ip-d", store, t + 3 * 3700_000);
    assert.equal(seventh.ok, false);
    assert.match(seventh.reason, /6 objects a day/);
    assert.match(seventh.reason, /library of 72/);
    assert.equal((await takeJobSlot("ip-e", store, t + 3 * 3700_000)).ok, true, "another IP is unaffected");
    assert.equal((await takeJobSlot("ip-d", store, Date.UTC(2026, 10, 11, 0, 1))).ok, true, "resets at 00:00 UTC");
  } finally {
    cleanup();
  }
});

test("IPv6 clients are keyed by their /64", () => {
  assert.equal(ipKey("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(ipKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff"), "2001:db8:1:2::/64");
  assert.equal(ipKey("[2001:db8::5]"), "2001:db8:0:0::/64");
  assert.equal(ipKey("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(ipKey("203.0.113.9"), "203.0.113.9");
  assert.equal(hashIp("2001:db8:1:2::1"), hashIp("2001:db8:1:2:dead:beef:0:7"));
  assert.notEqual(hashIp("2001:db8:1:2::1"), hashIp("2001:db8:1:3::1"));
  assert.notEqual(hashIp("203.0.113.9"), hashIp("203.0.113.10"));
});

test("capped slots: per-IP hour and bucket day", async () => {
  const { store, cleanup } = tempStore();
  try {
    const t = Date.UTC(2026, 10, 10, 12);
    for (let i = 0; i < 4; i++) assert.equal(await takeCappedSlot("exports", "ip-x", 4, 5, store, t + i), "ok");
    assert.equal(await takeCappedSlot("exports", "ip-x", 4, 5, store, t + 10), "hour");
    assert.equal(await takeCappedSlot("exports", "ip-y", 4, 5, store, t + 11), "ok");
    assert.equal(await takeCappedSlot("exports", "ip-z", 4, 5, store, t + 12), "day");
  } finally {
    cleanup();
  }
});
