import { test } from "node:test";
import assert from "node:assert/strict";
import { isPreconditionFailed, updateJSON } from "../../src/lib/storage.ts";
import { tempStore } from "./helpers.mjs";

test("local store: put, get, list, delete with content types", async () => {
  const { store, cleanup } = tempStore();
  try {
    assert.equal(await store.get("a/b.txt"), null);
    const w = await store.put("a/b.txt", "hello", { contentType: "text/plain" });
    const g = await store.get("a/b.txt");
    assert.equal(g.body.toString(), "hello");
    assert.equal(g.contentType, "text/plain");
    assert.equal(g.generation, w.generation);
    await store.put("a/c.bin", Buffer.from([1, 2, 3]));
    await store.put("z.json", "{}");
    assert.deepEqual(await store.list("a/"), ["a/b.txt", "a/c.bin"]);
    await store.delete("a/b.txt");
    assert.equal(await store.get("a/b.txt"), null);
    assert.deepEqual(await store.list("a/"), ["a/c.bin"]);
  } finally {
    cleanup();
  }
});

test("local store: generation-match refuses stale and duplicate writes", async () => {
  const { store, cleanup } = tempStore();
  try {
    const first = await store.putJSON("doc.json", { n: 1 }, { ifGenerationMatch: "0" });
    await assert.rejects(store.putJSON("doc.json", { n: 2 }, { ifGenerationMatch: "0" }), (e) => isPreconditionFailed(e));
    const second = await store.putJSON("doc.json", { n: 2 }, { ifGenerationMatch: first.generation });
    assert.notEqual(second.generation, first.generation);
    await assert.rejects(store.putJSON("doc.json", { n: 3 }, { ifGenerationMatch: first.generation }), (e) => isPreconditionFailed(e));
    assert.deepEqual((await store.getJSON("doc.json")).value, { n: 2 });
  } finally {
    cleanup();
  }
});

test("updateJSON: 25 parallel increments all land exactly once", async () => {
  const { store, cleanup } = tempStore();
  try {
    await Promise.all(
      Array.from({ length: 25 }, () => updateJSON(store, "counter.json", () => ({ n: 0 }), (v) => ({ n: v.n + 1 }), 200)),
    );
    assert.equal((await store.getJSON("counter.json")).value.n, 25);
  } finally {
    cleanup();
  }
});

test("keys are checked", async () => {
  const { store, cleanup } = tempStore();
  try {
    await assert.rejects(store.get("../etc/passwd"));
    await assert.rejects(store.put("/abs", "x"));
    await assert.rejects(store.put("a b", "x"));
  } finally {
    cleanup();
  }
});
