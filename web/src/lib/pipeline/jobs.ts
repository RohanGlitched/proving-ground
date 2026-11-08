import { randomBytes } from "node:crypto";
import { isPreconditionFailed, store as defaultStore, updateJSON, type Store } from "../storage";
import { AholoClient, AholoError, creditsFor, downloadOutput, humanError, isConcurrencyError, type CreateRequest, type Style, type Task, type Version } from "./aholo";
import { config, newId, TYPICAL_SECONDS } from "./config";
import { measureGlb, processModel } from "./process";
import { appendToLibrary, type ObjectMeta } from "./library";

/**
 * Jobs and the global queue.
 *
 * A job is one JSON doc (jobs/{id}.json). The queue is one JSON doc (queue.json). Both are only ever
 * changed with generation-match, so any number of pollers can advance them at once without double work:
 *
 * - Advancement is stateless and poll-driven: GET /api/jobs/:id and POST /api/tick call advanceJob(),
 *   which does whatever is due (start the next stage, collect a finished Lux3D task, process, publish) and
 *   returns. Nothing runs in the background.
 * - Only one job is "active" (it owns the account's single Lux3D slot); the rest wait in order.
 * - Before doing work an advancer takes a short lease on the job doc (a CAS write); a second advancer that
 *   loses the race just returns the current state. Polling a running Lux3D task needs no lease and no write.
 * - Output URLs expire after ~2 h, so a finished task's GLB is downloaded into storage in the same call
 *   that notices it finished. If the link has already expired, the stage is run again once.
 * - A GENERATION_CONCURRENCY_LIMIT_EXCEEDED answer leaves the stage pending and retries after 15 s.
 */

export type Kind = "object" | "pedestrian" | "articulated" | "export";
export type Source = "text" | "photo" | "library";
export type StageName =
  | "upload-input"
  | "generate"
  | "fetch-result"
  | "upload-for-split"
  | "part-split"
  | "upload-for-rig"
  | "rig"
  | "upload-for-retarget"
  | "retarget"
  | "upload-for-articulation"
  | "articulate"
  | "upload-for-export"
  | "export"
  | "process"
  | "publish";
export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type Stage = {
  name: StageName;
  status: StageStatus;
  taskId?: string;
  startedAt?: number;
  endedAt?: number;
  credits?: number;
  attempts?: number;
  reruns?: number;
  lastCredits?: number;
  note?: string;
};

export type JobInput = {
  text?: string;
  style?: Style;
  imageKey?: string;
  /** Short display name. */
  label?: string;
  /** Articulated objects: what moves ("the door swings open"). */
  motion?: string;
  version?: Version;
  faceCount?: number;
  /** false = never part-split; undefined = decide by size. */
  split?: boolean;
  /** Pedestrians: 1 after the rigger refused the first pose. */
  poseAttempt?: number;
  /** Export jobs: which published object, which format, and the stored model to convert. */
  objectId?: string;
  format?: ExportFormat;
  sourceKey?: string;
  /** Library entries: stable slug and category. */
  slug?: string;
  category?: string;
};

export type Job = {
  id: string;
  kind: Kind;
  source: Source;
  input: JobInput;
  stages: Stage[];
  status: "queued" | "running" | "done" | "failed";
  queuePosition: number | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  result?: { objectId: string };
  work: {
    inputUrl?: string;
    genOutputUrl?: string;
    genKey?: string;
    genUrl?: string;
    measure?: { bbox: { min: number[]; max: number[] }; maxDim: number; tris: number; meshes: number };
    splitKey?: string;
    splitParts?: number;
    rigKey?: string;
    rigUrl?: string;
    finalKey?: string;
    waitUntil?: number;
    credits: number;
    tasks: Partial<Record<StageName, string>>;
    outputs?: Partial<Record<StageName, string[]>>;
    process?: Record<string, number>;
    clip?: { name: string; duration: number };
  };
  lease?: { token: string; until: number };
  ipHash?: string;
};

export type QueueDoc = { items: { jobId: string; state: "queued" | "active"; since: number }[]; updatedAt: number };

export type LuxLike = Pick<AholoClient, "createTask" | "getTask" | "upload">;

export type Deps = {
  store: Store;
  lux: LuxLike;
  now: () => number;
  download: (url: string) => Promise<Buffer>;
  /** Wall-clock budget for one advance call (ms). */
  budgetMs: number;
  leaseMs: number;
  concurrencyWaitMs: number;
  stageTimeoutMs: number;
  log: (msg: string) => void;
};

let luxSingleton: AholoClient | null = null;
export function defaultDeps(over: Partial<Deps> = {}): Deps {
  return {
    store: over.store ?? defaultStore(),
    lux: over.lux ?? (luxSingleton ??= new AholoClient()),
    now: over.now ?? Date.now,
    download: over.download ?? ((u) => downloadOutput(u)),
    budgetMs: over.budgetMs ?? 60_000,
    leaseMs: over.leaseMs ?? 240_000,
    concurrencyWaitMs: over.concurrencyWaitMs ?? 15_000,
    stageTimeoutMs: over.stageTimeoutMs ?? 15 * 60_000,
    log: over.log ?? (() => undefined),
  };
}

export const jobKey = (id: string) => `jobs/${id}.json`;
export const QUEUE_KEY = "queue.json";
const LUX_STAGES: StageName[] = ["generate", "part-split", "rig", "retarget", "articulate"];
const MAX_CONCURRENCY_WAITS = 80;

export function stagesFor(kind: Kind, source: Source, hasImage: boolean): Stage[] {
  const names: StageName[] =
    kind === "object"
      ? ["upload-input", "generate", "fetch-result", "upload-for-split", "part-split", "process", "publish"]
      : kind === "export"
        ? ["upload-for-export", "export"]
      : kind === "pedestrian"
        ? ["upload-input", "generate", "fetch-result", "upload-for-rig", "rig", "upload-for-retarget", "retarget", "process", "publish"]
        : ["upload-input", "generate", "fetch-result", "upload-for-articulation", "articulate", "process", "publish"];
  return names.map((name) => ({ name, status: name === "upload-input" && !(hasImage || source === "photo") ? "skipped" : "pending" }));
}

/** Prompt sent to text-to-3D. */
export function buildPrompt(job: Pick<Job, "kind" | "input">): string {
  const t = (job.input.text ?? "").trim();
  if (job.kind === "pedestrian") {
    // Lux3D rigging refuses arms that hang by the torso (MODEL_NOT_RIGGABLE), so ask for a strict T-pose;
    // the second attempt (after a refusal) is blunter still.
    const retry = (job.input.poseAttempt ?? 0) > 0;
    return retry
      ? `${t}, T-pose character model: standing straight, both arms raised straight out sideways, horizontal at shoulder height, far from the body, hands open, legs apart, full body, realistic proportions`
      : `${t}, one person, full body, standing in a T-pose with both arms stretched straight out to the sides at shoulder height, legs slightly apart, realistic human proportions, life size`;
  }
  if (job.kind === "articulated") return `${t}, a single object with clearly separate moving parts, real-world size`;
  return `${t}, a single object, real-world size`;
}

export function motionPrompt(job: Pick<Job, "input">): string {
  return (job.input.motion ?? "").trim() || `the ${(job.input.text ?? "object").trim()} opens and closes`;
}

/* ───────────────────────── create / read ───────────────────────── */

export async function createJob(
  args: { kind: Kind; source: Source; input: JobInput; ipHash?: string; id?: string },
  deps: Pick<Deps, "store" | "now"> = defaultDeps(),
): Promise<Job> {
  const now = deps.now();
  const job: Job = {
    id: args.id ?? newId(),
    kind: args.kind,
    source: args.source,
    input: args.input,
    stages: stagesFor(args.kind, args.source, !!args.input.imageKey),
    status: "queued",
    queuePosition: null,
    createdAt: now,
    updatedAt: now,
    work: { credits: 0, tasks: {} },
    ipHash: args.ipHash,
  };
  await deps.store.putJSON(jobKey(job.id), job, { ifGenerationMatch: "0" });
  const q = await updateJSON<QueueDoc>(deps.store, QUEUE_KEY, emptyQueue, (q) => {
    if (!q.items.some((i) => i.jobId === job.id)) q.items.push({ jobId: job.id, state: "queued", since: now });
    q.updatedAt = now;
    return q;
  });
  job.queuePosition = positionIn(q, job.id);
  return job;
}

const emptyQueue = (): QueueDoc => ({ items: [], updatedAt: 0 });

function positionIn(q: QueueDoc, id: string): number | null {
  const active = q.items.filter((i) => i.state === "active").map((i) => i.jobId);
  if (active.includes(id)) return 0;
  const queued = q.items.filter((i) => i.state === "queued").map((i) => i.jobId);
  const k = queued.indexOf(id);
  return k < 0 ? null : k + 1;
}

export async function readQueue(s: Store): Promise<QueueDoc> {
  return (await s.getJSON<QueueDoc>(QUEUE_KEY))?.value ?? emptyQueue();
}

export async function getJob(id: string, s: Store): Promise<{ job: Job; generation: string } | null> {
  const g = await s.getJSON<Job>(jobKey(id));
  return g ? { job: g.value, generation: g.generation } : null;
}

const terminal = (j: Job) => j.status === "done" || j.status === "failed";

/* ───────────────────────── queue ───────────────────────── */

/** Makes `id` the active job if the slot is free and it is next in line. Returns true when it is active. */
async function claim(id: string, deps: Deps): Promise<boolean> {
  const now = deps.now();
  let claimed = false;
  await updateJSON<QueueDoc>(deps.store, QUEUE_KEY, emptyQueue, async (q) => {
    claimed = false;
    // drop stale entries: finished jobs, or an active job that has not moved for 30 min
    const keep: QueueDoc["items"] = [];
    for (const it of q.items) {
      if (it.state === "active" && it.jobId !== id) {
        const j = (await getJob(it.jobId, deps.store))?.job;
        if (!j || terminal(j) || now - (j.updatedAt ?? it.since) > 30 * 60_000) continue;
      }
      keep.push(it);
    }
    q.items = keep;
    const active = q.items.find((i) => i.state === "active");
    if (active) {
      claimed = active.jobId === id;
      return q;
    }
    const head = q.items.find((i) => i.state === "queued");
    if (head?.jobId === id) {
      head.state = "active";
      head.since = now;
      q.updatedAt = now;
      claimed = true;
    }
    return q;
  });
  return claimed;
}

async function dequeue(id: string, deps: Deps): Promise<void> {
  await updateJSON<QueueDoc>(deps.store, QUEUE_KEY, emptyQueue, (q) => {
    q.items = q.items.filter((i) => i.jobId !== id);
    q.updatedAt = deps.now();
    return q;
  });
}

/* ───────────────────────── advancing ───────────────────────── */

type StepResult = "progress" | "wait" | "terminal";

const taskCache = new Map<string, { at: number; task: Task }>();
async function pollTask(taskId: string, deps: Deps): Promise<Task> {
  const c = taskCache.get(taskId);
  if (c && deps.now() - c.at < 3000) return c.task;
  const task = await deps.lux.getTask(taskId);
  taskCache.set(taskId, { at: deps.now(), task });
  if (taskCache.size > 200) taskCache.delete(taskCache.keys().next().value!);
  return task;
}

function currentStage(job: Job): Stage | undefined {
  return job.stages.find((s) => s.status === "pending" || s.status === "running");
}

/** Public view: no lease, no internal URLs. */
export function publicJob(job: Job, q?: QueueDoc) {
  const pos = q ? positionIn(q, job.id) : job.queuePosition;
  const remaining = job.stages.filter((s) => s.status === "pending" || s.status === "running");
  let eta = remaining.reduce((t, s) => t + (TYPICAL_SECONDS[s.name] ?? 5), 0);
  const running = job.stages.find((s) => s.status === "running");
  if (running?.startedAt) eta -= Math.min((TYPICAL_SECONDS[running.name] ?? 5) * 0.9, (Date.now() - running.startedAt) / 1000);
  if (pos && pos > 1) eta += (pos - 1) * 200;
  return {
    id: job.id,
    kind: job.kind,
    source: job.source,
    input: { text: job.input.text, style: job.input.style, label: job.input.label, motion: job.input.motion },
    status: job.status,
    queuePosition: terminal(job) ? null : pos,
    stages: job.stages.map((s) => ({ name: s.name, status: s.status, note: s.note, startedAt: s.startedAt, endedAt: s.endedAt })),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    etaSeconds: terminal(job) ? 0 : Math.max(5, Math.round(eta)),
    error: job.error,
    result: job.result,
    credits: job.work.credits,
  };
}
export type PublicJob = ReturnType<typeof publicJob>;

/**
 * Advances one job as far as it can within the time budget. Safe to call from any number of places at
 * once. Returns the job as it stands afterwards (or null when there is no such job).
 */
export async function advanceJob(id: string, over: Partial<Deps> = {}): Promise<Job | null> {
  const deps = defaultDeps(over);
  const s = deps.store;
  const t0 = deps.now();
  let got = await getJob(id, s);
  if (!got) return null;
  let { job } = got;
  if (terminal(job)) return job;
  if (job.lease && job.lease.until > deps.now()) return job; // someone else is working on it

  // cheap paths that need no write
  const st = currentStage(job);
  if (job.status === "running" && st?.status === "running" && st.taskId) {
    try {
      const task = await pollTask(st.taskId, deps);
      if (task.status === "running" && deps.now() - (st.startedAt ?? 0) < deps.stageTimeoutMs) return job;
    } catch {
      return job; // Lux3D unreachable: try again on the next poll
    }
  }
  if (job.work.waitUntil && job.work.waitUntil > deps.now()) return job;
  if (job.status === "queued") {
    const q = await readQueue(s);
    const active = q.items.find((i) => i.state === "active");
    const head = q.items.find((i) => i.state === "queued");
    if (active && active.jobId !== id) {
      const aj = (await getJob(active.jobId, s))?.job;
      const stale = !aj || terminal(aj) || deps.now() - aj.updatedAt > 30 * 60_000;
      if (!stale) return job;
    }
    if (!active && head?.jobId !== id) return job;
    if (!(await claim(id, deps))) return job;
  }

  // take the lease
  const token = randomBytes(8).toString("hex");
  job.lease = { token, until: deps.now() + deps.leaseMs };
  job.updatedAt = deps.now();
  let generation: string;
  try {
    generation = (await s.putJSON(jobKey(id), job, { ifGenerationMatch: got.generation })).generation;
  } catch (e) {
    if (isPreconditionFailed(e)) return (await getJob(id, s))?.job ?? null;
    throw e;
  }

  const save = async () => {
    job.updatedAt = deps.now();
    generation = (await s.putJSON(jobKey(id), job, { ifGenerationMatch: generation })).generation;
  };

  try {
    for (let i = 0; i < 40; i++) {
      let r: StepResult;
      try {
        r = await step(job, deps);
      } catch (e) {
        failJob(job, e, deps);
        r = "terminal";
      }
      if (r === "terminal" || r === "wait") break;
      await save();
      if (deps.now() - t0 > deps.budgetMs) break;
    }
  } finally {
    job.lease = undefined;
    try {
      await save();
    } catch (e) {
      deps.log(`job ${id}: could not release the lease (${humanError(e)})`);
    }
  }
  if (terminal(job)) await dequeue(id, deps);
  got = await getJob(id, s);
  return got?.job ?? job;
}

function failJob(job: Job, e: unknown, deps: Deps) {
  const st = currentStage(job);
  if (st) {
    st.status = "failed";
    st.endedAt = deps.now();
  }
  job.status = "failed";
  job.error = humanError(e);
  job.finishedAt = deps.now();
  deps.log(`job ${job.id} failed at ${st?.name}: ${job.error}`);
}

function skip(job: Job, name: StageName, note: string) {
  const s = job.stages.find((x) => x.name === name);
  if (s && (s.status === "pending" || s.status === "running")) {
    s.status = "skipped";
    s.note = note;
  }
}

/** The model URL among a task's outputs: plain URLs, or URLs inside JSON outputs (retarget answers
 *  {"actions":[{"animation_id":"Walk_Loop","status":"success","animationGlbUrl":"…"}]}). */
export function pickGlb(outputs: { content: string; isUrl: boolean }[]): string | undefined {
  const urls = outputs.filter((o) => o.isUrl).map((o) => o.content);
  for (const o of outputs) {
    if (o.isUrl) continue;
    for (const m of o.content.matchAll(/https?:\/\/[^"'\s\\]+/g)) urls.push(m[0]);
  }
  return urls.find((u) => /\.glb(\?|$)/i.test(u)) ?? urls[0];
}

/** The error code a failed task reports in its outputs ({"error":{"code":…}}), if any. */
export function taskErrorCode(task: Task): string | undefined {
  for (const o of task.outputs) {
    if (o.isUrl) continue;
    try {
      const j = JSON.parse(o.content) as { error?: { code?: string }; code?: string };
      const c = j?.error?.code ?? j?.code;
      if (c) return String(c).replace(/[^A-Z0-9_]/gi, "").slice(0, 60);
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

function failureSentence(stage: StageName, code?: string): string {
  if (code === "MODEL_NOT_RIGGABLE") return "Lux3D could not fit a skeleton to this person (it needs arms held out in a T- or A-pose).";
  if (stage === "rig" || stage === "retarget") return "Lux3D could not animate this person.";
  if (stage === "articulate") return "Lux3D could not find the moving parts of this object.";
  return "Lux3D could not finish this model.";
}

/** Starts or collects one Lux3D stage. */
async function luxStage(
  job: Job,
  st: Stage,
  deps: Deps,
  makeReq: () => CreateRequest,
  onDone: (task: Task) => Promise<void>,
  onFail?: (msg: string, code?: string) => Promise<StepResult | null>,
): Promise<StepResult> {
  const now = deps.now();
  if (st.status === "pending") {
    const req = makeReq();
    try {
      st.taskId = await deps.lux.createTask(req);
    } catch (e) {
      if (isConcurrencyError(e)) {
        st.attempts = (st.attempts ?? 0) + 1;
        if (st.attempts > MAX_CONCURRENCY_WAITS) throw new AholoError("Lux3D stayed busy for too long; please try again later.", "concurrency", false);
        st.note = "Waiting for a free Lux3D slot";
        job.work.waitUntil = now + deps.concurrencyWaitMs;
        return "wait";
      }
      throw e;
    }
    st.status = "running";
    st.startedAt = now;
    st.note = st.reruns ? "re-run after the result link expired" : undefined;
    st.credits = (st.credits ?? 0) + creditsFor(req);
    st.lastCredits = creditsFor(req);
    job.work.credits += creditsFor(req);
    job.work.tasks[st.name] = st.taskId;
    job.work.waitUntil = undefined;
    deps.log(`job ${job.id}: ${st.name} started (task ${st.taskId}, ${st.credits} credits)`);
    return "progress";
  }
  // running
  const task = await pollTask(st.taskId!, deps);
  if (task.status === "running") {
    if (now - (st.startedAt ?? now) > deps.stageTimeoutMs) {
      const msg = "Lux3D did not finish in time.";
      const alt = onFail ? await onFail(msg) : null;
      if (alt) return alt;
      throw new AholoError(msg, "server", false);
    }
    return "wait";
  }
  if (task.status === "done") {
    job.work.outputs ??= {};
    job.work.outputs[st.name] = task.outputs.map((o) => (o.isUrl ? o.content.split("?")[0] : o.content.slice(0, 500)));
    await onDone(task);
    st.status = "done";
    st.endedAt = deps.now();
    deps.log(`job ${job.id}: ${st.name} done in ${Math.round((st.endedAt - (st.startedAt ?? st.endedAt)) / 1000)} s`);
    return "progress";
  }
  // failed tasks are not charged (measured Nov 9: a failed rig left the balance unchanged)
  job.work.credits -= st.lastCredits ?? 0;
  st.credits = (st.credits ?? 0) - (st.lastCredits ?? 0);
  const code = taskErrorCode(task);
  job.work.outputs ??= {};
  job.work.outputs[st.name] = task.outputs.map((o) => o.content.slice(0, 500));
  const msg = task.status === "cancelled" ? "The Lux3D task was cancelled." : failureSentence(st.name, code);
  deps.log(`job ${job.id}: ${st.name} failed${code ? ` (${code})` : ""}`);
  const alt = onFail ? await onFail(msg, code) : null;
  if (alt) return alt;
  throw new AholoError(msg, "server", false);
}

async function uploadStage(job: Job, st: Stage, deps: Deps, key: string, assign: (url: string) => void): Promise<StepResult> {
  const g = await deps.store.get(key);
  if (!g) throw new Error("A stored model file is missing.");
  assign(await deps.lux.upload(g.body, key.split("/").pop()!));
  st.status = "done";
  st.endedAt = deps.now();
  return "progress";
}

async function step(job: Job, deps: Deps): Promise<StepResult> {
  if (job.status === "queued") {
    job.status = "running";
    job.startedAt = deps.now();
    return "progress";
  }
  const st = currentStage(job);
  if (!st) {
    job.status = "done";
    job.finishedAt = deps.now();
    return "terminal";
  }
  if (!st.startedAt) st.startedAt = deps.now();
  const s = deps.store;
  const id = job.id;
  const version = job.input.version ?? config.version;
  const faceCount = job.input.faceCount ?? config.faceCount;

  switch (st.name) {
    case "upload-input": {
      if (!job.input.imageKey) {
        st.status = "skipped";
        return "progress";
      }
      return uploadStage(job, st, deps, job.input.imageKey, (u) => (job.work.inputUrl = u));
    }
    case "generate":
      return luxStage(
        job,
        st,
        deps,
        () =>
          job.work.inputUrl
            ? { op: "img-to-3d", img: job.work.inputUrl, version, faceCount }
            : { op: "text-to-3d", prompt: buildPrompt(job), style: job.kind === "pedestrian" ? "photorealistic" : (job.input.style ?? "photorealistic"), version, faceCount },
        async (task) => {
          const url = pickGlb(task.outputs);
          if (!url) throw new AholoError("Lux3D finished without a model file.", "server", false);
          job.work.genOutputUrl = url;
        },
      );
    case "fetch-result": {
      let buf: Buffer;
      try {
        buf = await deps.download(job.work.genOutputUrl!);
      } catch (e) {
        const gen = job.stages.find((x) => x.name === "generate")!;
        if (e instanceof AholoError && e.kind === "expired" && (gen.reruns ?? 0) < 1) {
          // the 2-hour link lapsed before anyone collected it: run generation again, once
          Object.assign(gen, { status: "pending", taskId: undefined, startedAt: undefined, endedAt: undefined, reruns: (gen.reruns ?? 0) + 1 });
          st.startedAt = undefined;
          return "progress";
        }
        throw e;
      }
      job.work.genKey = `raw/${id}/gen.glb`;
      await s.put(job.work.genKey, buf, { contentType: "model/gltf-binary" });
      const m = await measureGlb(buf);
      job.work.measure = { bbox: m.bbox, maxDim: m.maxDim, tris: m.tris, meshes: m.meshes };
      if (job.kind === "object") {
        if (job.input.split === false) {
          skip(job, "upload-for-split", "not needed for this shape");
          skip(job, "part-split", "not needed for this shape");
        } else if (m.maxDim < config.splitMinDim) {
          skip(job, "upload-for-split", `small object (${Math.round(m.maxDim * 100)} cm)`);
          skip(job, "part-split", `small object (${Math.round(m.maxDim * 100)} cm), one part`);
        }
      }
      st.status = "done";
      st.endedAt = deps.now();
      return "progress";
    }
    case "upload-for-split":
    case "upload-for-rig":
    case "upload-for-articulation":
      return uploadStage(job, st, deps, job.work.genKey!, (u) => (job.work.genUrl = u));
    case "upload-for-retarget":
      return uploadStage(job, st, deps, job.work.rigKey!, (u) => (job.work.rigUrl = u));
    case "part-split":
      return luxStage(
        job,
        st,
        deps,
        () => ({ op: "part-split", glbUrl: job.work.genUrl! }),
        async (task) => {
          const url = pickGlb(task.outputs);
          if (!url) {
            st.note = "no parts returned; using the whole mesh";
            return;
          }
          const buf = await deps.download(url);
          const m = await measureGlb(buf);
          job.work.splitParts = m.meshes;
          if (m.meshes <= 1) {
            st.note = "one part; using the whole mesh";
            return;
          }
          job.work.splitKey = `raw/${id}/split.glb`;
          await s.put(job.work.splitKey, buf, { contentType: "model/gltf-binary" });
          st.note = `${m.meshes} parts`;
        },
        async () => {
          st.status = "skipped";
          st.endedAt = deps.now();
          st.note = "part split failed; using the whole mesh";
          return "progress";
        },
      );
    case "rig":
      return luxStage(
        job,
        st,
        deps,
        () => ({ op: "rig", modelUrl: job.work.genUrl! }),
        async (task) => {
          const url = pickGlb(task.outputs);
          if (!url) throw new AholoError("Rigging finished without a model file.", "server", false);
          job.work.rigKey = `raw/${id}/rig.glb`;
          await s.put(job.work.rigKey, await deps.download(url), { contentType: "model/gltf-binary" });
        },
        async (_msg, code) => {
          if (code !== "MODEL_NOT_RIGGABLE" || (job.input.poseAttempt ?? 0) >= 1 || job.input.imageKey) return null;
          // generate the person again with a blunter T-pose prompt, then rig again
          job.input.poseAttempt = 1;
          for (const n of ["generate", "fetch-result", "upload-for-rig", "rig"] as StageName[]) {
            const x = job.stages.find((y) => y.name === n)!;
            Object.assign(x, { status: "pending", taskId: undefined, startedAt: undefined, endedAt: undefined, note: n === "generate" ? "second try with a stricter T-pose" : undefined });
          }
          return "progress";
        },
      );
    case "retarget":
      return luxStage(
        job,
        st,
        deps,
        () => ({ op: "retarget", rigModelUrl: job.work.rigUrl!, animationIds: ["Walk_Loop"], animateInPlace: true }),
        async (task) => {
          const url = pickGlb(task.outputs);
          if (!url) throw new AholoError("The walk animation finished without a model file.", "server", false);
          job.work.finalKey = `raw/${id}/final.glb`;
          await s.put(job.work.finalKey, await deps.download(url), { contentType: "model/gltf-binary" });
        },
      );
    case "articulate":
      return luxStage(
        job,
        st,
        deps,
        () => ({ op: "articulation", glbUrl: job.work.genUrl!, prompt: motionPrompt(job) }),
        async (task) => {
          const url = pickGlb(task.outputs);
          if (!url) throw new AholoError("Articulation finished without a model file.", "server", false);
          job.work.finalKey = `raw/${id}/final.glb`;
          await s.put(job.work.finalKey, await deps.download(url), { contentType: "model/gltf-binary" });
        },
      );
    case "upload-for-export":
      return uploadStage(job, st, deps, job.input.sourceKey!, (u) => (job.work.genUrl = u));
    case "export":
      return luxStage(
        job,
        st,
        deps,
        () => ({ op: "export", modelUrl: job.work.genUrl!, outputFormat: [job.input.format!] }),
        async (task) => {
          const url = pickExport(task.outputs, job.input.format!);
          if (!url) throw new AholoError("The export finished without a file.", "server", false);
          await s.put(exportKey(job.input.objectId!, job.input.format!), await deps.download(url), { contentType: EXPORT_FORMATS[job.input.format!].type });
          job.result = { objectId: job.input.objectId! };
        },
      );
    case "process": {
      const key = job.kind === "object" ? (job.work.splitKey ?? job.work.genKey!) : job.work.finalKey!;
      const g = await s.get(key);
      if (!g) throw new Error("A stored model file is missing.");
      const r = await processModel({
        glb: g.body,
        split: job.kind === "object" && !!job.work.splitKey,
        wholeGlb: job.kind === "object" && job.work.splitKey ? (await s.get(job.work.genKey!))?.body : undefined,
        animated: job.kind !== "object",
        inPlace: job.kind === "pedestrian" ? true : undefined,
        clipName: job.kind === "pedestrian" ? "Walk_Loop" : undefined,
      });
      await s.put(`objects/${id}/visual.glb`, r.visual, { contentType: "model/gltf-binary" });
      await s.put(`objects/${id}/parts.json`, r.partsJson, { contentType: "application/json" });
      const clip = r.parts.animated?.clips[0];
      if (clip) job.work.clip = clip;
      job.work.process = { ...r.stats, volume: r.parts.volume, bboxMinX: r.parts.bbox.min[0], bboxMinY: r.parts.bbox.min[1], bboxMinZ: r.parts.bbox.min[2], bboxMaxX: r.parts.bbox.max[0], bboxMaxY: r.parts.bbox.max[1], bboxMaxZ: r.parts.bbox.max[2] };
      st.status = "done";
      st.endedAt = deps.now();
      st.note = `${r.stats.parts} part${r.stats.parts === 1 ? "" : "s"}, ${Math.round(r.stats.visualBytes / 1024)} KB`;
      return "progress";
    }
    case "publish": {
      const p = job.work.process!;
      const meta: ObjectMeta = {
        id,
        slug: job.input.slug,
        name: displayName(job),
        kind: job.kind as ObjectMeta["kind"],
        source: job.source,
        category: job.input.category,
        prompt: job.input.text,
        style: job.input.style ?? (job.input.imageKey ? undefined : "photorealistic"),
        motion: job.kind === "articulated" ? motionPrompt(job) : undefined,
        version,
        up: "y",
        unit: "m",
        bbox: { min: [p.bboxMinX, p.bboxMinY, p.bboxMinZ], max: [p.bboxMaxX, p.bboxMaxY, p.bboxMaxZ] },
        size: [p.bboxMaxX - p.bboxMinX, p.bboxMaxY - p.bboxMinY, p.bboxMaxZ - p.bboxMinZ].map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
        parts: p.parts,
        volume: p.volume,
        split: job.work.splitKey ? "parts" : (job.stages.find((x) => x.name === "part-split")?.note ?? "whole"),
        tris: p.tris,
        bytes: { visual: p.visualBytes, parts: p.partsBytes },
        hasInput: !!job.input.imageKey,
        createdAt: deps.now(),
        credits: job.work.credits,
        lux3dTasks: job.work.tasks as Record<string, string>,
        animated: job.kind === "object" ? undefined : { clip: job.work.clip?.name ?? (job.kind === "pedestrian" ? "Walk_Loop" : "articulation"), inPlace: job.kind === "pedestrian" ? true : undefined, duration: job.work.clip?.duration },
      };
      await s.putJSON(`objects/${id}/meta.json`, meta);
      await appendToLibrary(meta, s);
      job.result = { objectId: id };
      st.status = "done";
      st.endedAt = deps.now();
      job.status = "done";
      job.finishedAt = deps.now();
      return "terminal";
    }
  }
}

/* ───────────────────────── exports ───────────────────────── */

export const EXPORT_FORMATS = {
  stl: { ext: "stl", type: "model/stl" },
  "3mf": { ext: "3mf", type: "model/3mf" },
  usdz: { ext: "usdz", type: "model/vnd.usdz+zip" },
  fbx_zip: { ext: "fbx.zip", type: "application/zip" },
  obj_zip: { ext: "obj.zip", type: "application/zip" },
} as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;
export const isExportFormat = (f: unknown): f is ExportFormat => typeof f === "string" && Object.hasOwn(EXPORT_FORMATS, f);
export const exportKey = (id: string, f: ExportFormat) => `objects/${id}/export/${f}`;

/** The output URL for a format: one whose path mentions the format's extension, else the first URL. */
function pickExport(outputs: { content: string; isUrl: boolean }[], f: ExportFormat): string | undefined {
  const urls = outputs.filter((o) => o.isUrl).map((o) => o.content);
  for (const o of outputs) if (!o.isUrl) for (const m of o.content.matchAll(/https?:\/\/[^"'\s\\]+/g)) urls.push(m[0]);
  const want = f === "fbx_zip" || f === "obj_zip" ? [f.split("_")[0], "zip"] : [f];
  return urls.find((u) => want.some((w) => u.split("?")[0].toLowerCase().includes(`.${w}`))) ?? urls[0];
}

/**
 * The stored model an export is made from: the raw Lux3D result (the walking GLB for pedestrians, the
 * whole mesh for objects), never the compressed visual.glb.
 */
export async function exportSource(objectId: string, s: Store): Promise<string | null> {
  const job = (await getJob(objectId, s))?.job;
  const keys = [job?.work.finalKey, job?.work.genKey, `raw/${objectId}/gen.glb`].filter(Boolean) as string[];
  for (const k of keys) {
    const g = await s.list(k, 1);
    if (g.includes(k)) return k;
  }
  return null;
}

/** Starts (or finds) the export job for an object+format. Returns the job id. */
export async function startExport(objectId: string, format: ExportFormat, deps: Pick<Deps, "store" | "now">): Promise<{ jobId: string; existing: boolean }> {
  const s = deps.store;
  const pointer = `${exportKey(objectId, format)}.job.json`;
  const prev = await s.getJSON<{ jobId: string }>(pointer);
  if (prev) {
    const j = (await getJob(prev.value.jobId, s))?.job;
    if (j && j.status !== "failed") return { jobId: j.id, existing: true };
  }
  const sourceKey = await exportSource(objectId, s);
  if (!sourceKey) throw new AholoError("This object has no source model to export.", "input", false);
  const job = await createJob({ kind: "export", source: "library", input: { objectId, format, sourceKey } }, deps);
  await s.putJSON(pointer, { jobId: job.id }, { ifGenerationMatch: prev ? prev.generation : "0" }).catch(() => undefined);
  return { jobId: job.id, existing: false };
}

export function displayName(job: Pick<Job, "input" | "source">): string {
  const raw = (job.input.label || job.input.text || (job.source === "photo" ? "Photo object" : "Object")).trim();
  const s = raw.length > 40 ? raw.slice(0, 39).trimEnd() + "…" : raw;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ───────────────────────── tick ───────────────────────── */

/** Advances the active job, or starts the head of the queue. Returns what it touched. */
export async function tick(over: Partial<Deps> = {}): Promise<{ advanced: string[]; queueLength: number }> {
  const deps = defaultDeps(over);
  const advanced: string[] = [];
  for (let round = 0; round < 3; round++) {
    const q = await readQueue(deps.store);
    const next = q.items.find((i) => i.state === "active") ?? q.items.find((i) => i.state === "queued");
    if (!next) break;
    const before = (await getJob(next.jobId, deps.store))?.job;
    if (!before) {
      await dequeue(next.jobId, deps);
      continue;
    }
    const after = await advanceJob(next.jobId, deps);
    advanced.push(next.jobId);
    // keep going only when this job just finished (so the next one can take the slot now)
    if (!after || !terminal(after)) break;
  }
  const q = await readQueue(deps.store);
  return { advanced, queueLength: q.items.length };
}

/** Runs a job to completion in this process (scripts). Polls every `intervalMs`. */
export async function runToCompletion(id: string, over: Partial<Deps> = {}, intervalMs = 5000, onUpdate?: (j: Job) => void): Promise<Job> {
  for (;;) {
    const j = await advanceJob(id, over);
    if (!j) throw new Error(`job ${id} vanished`);
    onUpdate?.(j);
    if (terminal(j)) return j;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
