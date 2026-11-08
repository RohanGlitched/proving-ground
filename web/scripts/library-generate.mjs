// Pre-generates the library through the same pipeline the site uses, one Lux3D task at a time.
//
//   node --env-file=.env.local --import tsx scripts/library-generate.mjs [--only a,b] [--limit N] [--dry] [--version G1]
//
// Resumable: scripts/library-log.json records each slug's job; done slugs are skipped and an unfinished job
// is picked up where it stopped. Writes to the configured store (web/.data by default; GCS when GCS_BUCKET is
// set). Stops before an item when the balance would drop under 600 credits or the run would pass 2,500.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AholoClient } from "../src/lib/pipeline/aholo.ts";
import { createJob, getJob, runToCompletion } from "../src/lib/pipeline/jobs.ts";
import { store } from "../src/lib/storage.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIST = path.join(HERE, "library-list.json");
const LOG = path.join(HERE, "library-log.json");
const BUDGET = Number(process.env.LIBRARY_BUDGET ?? 2500);
const FLOOR = Number(process.env.LIBRARY_FLOOR ?? 600);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined;
};
const only = typeof opt("only") === "string" ? opt("only").split(",") : null;
const limit = opt("limit") ? Number(opt("limit")) : Infinity;
const dry = !!opt("dry");
const forceVersion = typeof opt("version") === "string" ? opt("version") : undefined;
const suffix = typeof opt("suffix") === "string" ? opt("suffix") : "";

const list = JSON.parse(readFileSync(LIST, "utf8")).items;
const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : { items: {}, totalCredits: 0, runs: [] };
const saveLog = () => writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");

export function estimate(item, version = item.version ?? "G1-Turbo") {
  const gen = version === "G1" ? 20 : 13;
  if (item.kind === "pedestrian") return gen + 15 + 6;
  if (item.kind === "articulated") return gen + 28;
  return gen + (item.split === false ? 0 : 30);
}

const stamp = () => new Date().toISOString().slice(11, 19);
const say = (...m) => console.log(`[${stamp()}]`, ...m);

const lux = new AholoClient();
const todo = list.filter((it) => (!only || only.includes(it.slug)) && log.items[it.slug + suffix]?.status !== "done");
say(`${todo.length} to make (${list.length} listed); est. ${todo.reduce((s, it) => s + estimate(it, forceVersion), 0)} credits; spent so far ${log.totalCredits}`);
if (dry) {
  for (const it of todo) console.log(`  ${it.slug.padEnd(22)} ${String(estimate(it, forceVersion)).padStart(3)}  ${it.kind ?? "object"}${it.split === false ? " (no split)" : ""}`);
  process.exit(0);
}

let made = 0;
for (const it of todo) {
  if (made >= limit) break;
  const slug = it.slug + suffix;
  const version = forceVersion ?? it.version ?? "G1-Turbo";
  const est = estimate(it, version);
  const { credits: before } = await lux.balance();
  if (before - est < FLOOR) {
    say(`stop: balance ${before} would fall under ${FLOOR}`);
    break;
  }
  if (log.totalCredits + est > BUDGET) {
    say(`stop: run budget ${BUDGET} reached (${log.totalCredits} spent)`);
    break;
  }
  let entry = log.items[slug];
  let jobId = entry?.jobId;
  const existing = jobId ? await getJob(jobId, store()) : null;
  if (!existing || existing.job.status === "failed") {
    const job = await createJob({
      kind: it.kind ?? "object",
      source: "library",
      input: { text: it.text, style: it.style ?? "photorealistic", label: it.name, slug, category: it.category, split: it.split, motion: it.motion, version },
    });
    jobId = job.id;
    entry = log.items[slug] = { jobId, status: "running", startedAt: new Date().toISOString(), balanceBefore: before, version };
    saveLog();
  }
  say(`${slug}: job ${jobId} (${version}, est ${est})`);
  const t0 = Date.now();
  let lastLine = "";
  const job = await runToCompletion(jobId, { log: (m) => say("  " + m), budgetMs: 120_000 }, 5000, (j) => {
    const s = j.stages.find((x) => x.status === "running" || x.status === "pending");
    const line = `${j.status} ${s ? `${s.name}:${s.status}${s.note ? ` (${s.note})` : ""}` : ""}`;
    if (line !== lastLine) say(`  ${line}`);
    lastLine = line;
  });
  const { credits: after } = await lux.balance().catch(() => ({ credits: null }));
  entry.status = job.status;
  entry.objectId = job.result?.objectId;
  entry.error = job.error;
  entry.credits = job.work.credits;
  entry.balanceAfter = after;
  entry.measuredCredits = after === null ? null : before - after;
  entry.seconds = Math.round((Date.now() - t0) / 1000);
  entry.stages = Object.fromEntries(job.stages.map((s) => [s.name, s.startedAt && s.endedAt ? Math.round((s.endedAt - s.startedAt) / 1000) : s.status]));
  entry.process = job.work.process ? { parts: job.work.process.parts, tris: job.work.process.tris, visualKB: Math.round(job.work.process.visualBytes / 1024), partsKB: Math.round(job.work.process.partsBytes / 1024) } : undefined;
  entry.finishedAt = new Date().toISOString();
  log.totalCredits = Object.values(log.items).reduce((s, e) => s + (e.measuredCredits ?? e.credits ?? 0), 0);
  saveLog();
  say(`${slug}: ${job.status}${job.error ? ` (${job.error})` : ""} in ${entry.seconds} s, ${entry.credits} credits (balance ${before} → ${after}), ${entry.process ? `${entry.process.parts} parts, ${entry.process.visualKB} KB` : ""}`);
  made++;
}
say(`done: ${Object.values(log.items).filter((e) => e.status === "done").length}/${list.length} in the log, ${log.totalCredits} credits spent`);
