import { test } from "node:test";
import assert from "node:assert/strict";
import { AholoError } from "../../src/lib/pipeline/aholo.ts";
import { advanceJob, createJob, readQueue, runToCompletion, tick } from "../../src/lib/pipeline/jobs.ts";
import { readLibrary } from "../../src/lib/pipeline/library.ts";
import { fakeClock, hasSamples, readSample, tempStore } from "./helpers.mjs";

let seq = 0;

/**
 * A fake Lux3D: each task finishes after `pollsToFinish` polls. Only one task may run at a time on the
 * account (like the real one): creating a second while one runs throws the concurrency error.
 */
function fakeLux({ pollsToFinish = 2, concurrencyFailures = 0, failOps = [], failOnce = {} } = {}) {
  const tasks = new Map();
  const calls = { create: [], upload: 0 };
  let concurrencyLeft = concurrencyFailures;
  const prefix = `t${++seq}-`;
  return {
    calls,
    tasks,
    lux: {
      async createTask(req) {
        const running = [...tasks.values()].some((t) => t.polls < pollsToFinish);
        if (running || concurrencyLeft > 0) {
          if (concurrencyLeft > 0) concurrencyLeft--;
          throw new AholoError("Lux3D is busy", "concurrency", true);
        }
        const id = `${prefix}${tasks.size + 1}`;
        tasks.set(id, { req, polls: 0 });
        calls.create.push(req.op);
        return id;
      },
      async getTask(id) {
        const t = tasks.get(id);
        t.polls++;
        if (t.polls < pollsToFinish) return { taskId: id, status: "running", rawStatus: 1, outputs: [] };
        if (failOps.includes(t.req.op)) return { taskId: id, status: "failed", rawStatus: 4, outputs: [] };
        if (failOnce[t.req.op] && !t.passOnce) {
          t.fail = failOnce[t.req.op];
          delete failOnce[t.req.op];
        } else if (!t.fail) t.passOnce = true;
        if (t.fail) {
          const code = t.fail;
          return { taskId: id, status: "failed", rawStatus: 4, outputs: [{ content: JSON.stringify({ error: { code, message: "arms down" } }), isUrl: false }] };
        }
        return { taskId: id, status: "done", rawStatus: 3, outputs: [{ content: `https://cdn.example/${t.req.op}/${id}.glb?sig=1`, isUrl: true }] };
      },
      async upload(buf, name) {
        calls.upload++;
        return `https://ous.example/${name}`;
      },
    },
  };
}

const download = async (url) => {
  if (url.includes("/part-split/")) return readSample("chair-parts.glb");
  return readSample("chair.glb");
};

test("an object job runs end to end: generate, part-split, process, publish", { skip: !hasSamples() && "dev-samples missing" }, async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux();
  try {
    const job = await createJob({ kind: "object", source: "text", input: { text: "a wooden chair" } }, { store, now: clock.now });
    assert.equal(job.queuePosition, 1);
    const done = await runToCompletion(job.id, { store, lux: f.lux, download, now: clock.now, concurrencyWaitMs: 0 }, 0);
    assert.equal(done.status, "done", done.error);
    assert.deepEqual(f.calls.create, ["text-to-3d", "part-split"]);
    assert.equal(done.work.credits, 13 + 30);
    assert.equal(done.result.objectId, job.id);
    const meta = (await store.getJSON(`objects/${job.id}/meta.json`)).value;
    assert.equal(meta.parts, 8);
    assert.equal(meta.split, "parts");
    assert.equal(meta.up, "y");
    assert.equal(meta.unit, "m");
    assert.ok(Math.abs(meta.size[1] - 0.85) < 0.01, `chair height ${meta.size[1]}`);
    const lib = await readLibrary(store);
    assert.equal(lib.items.length, 1);
    assert.equal((await readQueue(store)).items.length, 0, "finished job leaves the queue");
  } finally {
    cleanup();
  }
});

test("two advancers racing on the same job never start a stage twice", { skip: !hasSamples() && "dev-samples missing" }, async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux({ pollsToFinish: 3 });
  try {
    const job = await createJob({ kind: "object", source: "text", input: { text: "a chair" } }, { store, now: clock.now });
    const deps = { store, lux: f.lux, download, now: clock.now, concurrencyWaitMs: 0 };
    for (let i = 0; i < 40; i++) {
      const [a, b] = await Promise.all([advanceJob(job.id, deps), advanceJob(job.id, deps)]);
      if (a.status === "done" && b.status === "done") break;
    }
    const j = (await store.getJSON(`jobs/${job.id}.json`)).value;
    assert.equal(j.status, "done", j.error);
    assert.deepEqual(f.calls.create, ["text-to-3d", "part-split"], "each Lux3D stage created exactly once");
  } finally {
    cleanup();
  }
});

test("queue: the second job waits for the first, and tick advances the head", { skip: !hasSamples() && "dev-samples missing" }, async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux();
  try {
    const deps = { store, lux: f.lux, download, now: clock.now, concurrencyWaitMs: 0 };
    const a = await createJob({ kind: "object", source: "text", input: { text: "a chair" } }, deps);
    const b = await createJob({ kind: "object", source: "text", input: { text: "a stool" } }, deps);
    assert.equal(b.queuePosition, 2);
    // polling B first does nothing: A is ahead
    const b1 = await advanceJob(b.id, deps);
    assert.equal(b1.status, "queued");
    assert.equal(f.calls.create.length, 0);
    // A starts, B still waits while A is active
    await advanceJob(a.id, deps);
    assert.equal(f.calls.create.length, 1);
    assert.equal((await advanceJob(b.id, deps)).status, "queued");
    // ticks alone drive both to completion
    for (let i = 0; i < 60; i++) {
      await tick(deps);
      const jb = (await store.getJSON(`jobs/${b.id}.json`)).value;
      if (jb.status === "done") break;
    }
    const ja = (await store.getJSON(`jobs/${a.id}.json`)).value;
    const jb = (await store.getJSON(`jobs/${b.id}.json`)).value;
    assert.equal(ja.status, "done");
    assert.equal(jb.status, "done");
    assert.ok(ja.finishedAt <= jb.stages.find((s) => s.name === "generate").startedAt, "B generated only after A finished");
    assert.equal((await readLibrary(store)).items.length, 2);
  } finally {
    cleanup();
  }
});

test("a Lux3D concurrency error re-queues the stage instead of failing", { skip: !hasSamples() && "dev-samples missing" }, async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux({ concurrencyFailures: 3 });
  try {
    const job = await createJob({ kind: "object", source: "text", input: { text: "a chair" } }, { store, now: clock.now });
    const done = await runToCompletion(job.id, { store, lux: f.lux, download, now: clock.now, concurrencyWaitMs: 0 }, 0);
    assert.equal(done.status, "done", done.error);
    assert.equal(done.stages.find((s) => s.name === "generate").attempts, 3);
  } finally {
    cleanup();
  }
});

test("part-split failure falls back to the whole mesh", { skip: !hasSamples() && "dev-samples missing" }, async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux({ failOps: ["part-split"] });
  try {
    const job = await createJob({ kind: "object", source: "text", input: { text: "a chair" } }, { store, now: clock.now });
    const done = await runToCompletion(job.id, { store, lux: f.lux, download, now: clock.now, concurrencyWaitMs: 0 }, 0);
    assert.equal(done.status, "done", done.error);
    const split = done.stages.find((s) => s.name === "part-split");
    assert.equal(split.status, "skipped");
    assert.match(split.note, /whole mesh/);
    assert.equal(done.work.credits, 13, "a failed task is not charged");
    assert.equal((await store.getJSON(`objects/${job.id}/parts.json`)).value.parts.length, 1);
  } finally {
    cleanup();
  }
});

test("small objects skip part-split; an expired result link re-runs generation once", { skip: !hasSamples() && "dev-samples missing" }, async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux();
  let expiredOnce = false;
  const dl = async (url) => {
    if (!expiredOnce) {
      expiredOnce = true;
      throw new AholoError("expired", "expired", false);
    }
    return readSample("sneaker.glb"); // 28 cm
  };
  try {
    process.env.SPLIT_MIN_DIM = "0.3";
    const job = await createJob({ kind: "object", source: "photo", input: { imageKey: "inputs/x.jpg" } }, { store, now: clock.now });
    await store.put("inputs/x.jpg", Buffer.from([0xff, 0xd8, 0xff, 0x00]), { contentType: "image/jpeg" });
    const done = await runToCompletion(job.id, { store, lux: f.lux, download: dl, now: clock.now, concurrencyWaitMs: 0 }, 0);
    assert.equal(done.status, "done", done.error);
    assert.deepEqual(f.calls.create, ["img-to-3d", "img-to-3d"], "generation ran twice (link expired once), no part-split");
    assert.equal(done.stages.find((s) => s.name === "part-split").status, "skipped");
    assert.equal(done.work.credits, 2);
  } finally {
    delete process.env.SPLIT_MIN_DIM;
    cleanup();
  }
});

test("pedestrian: an unriggable pose re-generates once with a stricter T-pose, then rigs and walks", { skip: !hasSamples() && "dev-samples missing" }, async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux({ failOnce: { rig: "MODEL_NOT_RIGGABLE" } });
  try {
    const job = await createJob({ kind: "pedestrian", source: "text", input: { text: "a jogger" } }, { store, now: clock.now });
    const done = await runToCompletion(job.id, { store, lux: f.lux, download, now: clock.now, concurrencyWaitMs: 0 }, 0);
    assert.equal(done.status, "done", done.error);
    assert.deepEqual(f.calls.create, ["text-to-3d", "rig", "text-to-3d", "rig", "retarget"]);
    assert.match(f.tasks.get([...f.tasks.keys()][2]).req.prompt, /T-pose character model/);
    assert.equal(done.work.credits, 13 + 13 + 15 + 6, "the refused rig is not charged");
  } finally {
    cleanup();
  }
});

test("pedestrian: a second refusal fails the job with a plain sentence", { skip: !hasSamples() && "dev-samples missing" }, async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux();
  f.lux.getTask = (orig => async (id) => {
    const t = await orig(id);
    if (t.status === "done" && f.tasks.get(id).req.op === "rig") return { ...t, status: "failed", outputs: [{ content: '{"error":{"code":"MODEL_NOT_RIGGABLE"}}', isUrl: false }] };
    return t;
  })(f.lux.getTask);
  try {
    const job = await createJob({ kind: "pedestrian", source: "text", input: { text: "a jogger" } }, { store, now: clock.now });
    const done = await runToCompletion(job.id, { store, lux: f.lux, download, now: clock.now, concurrencyWaitMs: 0 }, 0);
    assert.equal(done.status, "failed");
    assert.match(done.error, /skeleton/);
    assert.equal(done.work.credits, 26);
  } finally {
    cleanup();
  }
});

test("export: one job per object+format, stored under objects/{id}/export/{format}", async () => {
  const { store, cleanup } = tempStore();
  const clock = fakeClock();
  const f = fakeLux();
  const { startExport, exportKey } = await import("../../src/lib/pipeline/jobs.ts");
  try {
    await store.put("raw/abc123defg/gen.glb", Buffer.from("glb"), { contentType: "model/gltf-binary" });
    const a = await startExport("abc123defg", "stl", { store, now: clock.now });
    const b = await startExport("abc123defg", "stl", { store, now: clock.now });
    assert.equal(a.jobId, b.jobId, "a second request reuses the job");
    const done = await runToCompletion(a.jobId, { store, lux: f.lux, download: async () => Buffer.from("solid x"), now: clock.now, concurrencyWaitMs: 0 }, 0);
    assert.equal(done.status, "done", done.error);
    assert.deepEqual(f.calls.create, ["export"]);
    assert.equal(f.tasks.get([...f.tasks.keys()][0]).req.outputFormat[0], "stl");
    assert.equal((await store.get(exportKey("abc123defg", "stl"))).body.toString(), "solid x");
    assert.equal(done.work.credits, 1);
  } finally {
    cleanup();
  }
});
