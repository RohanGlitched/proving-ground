import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

/**
 * One small object store for jobs, the queue, the library and courses.
 *
 * Two backends behind the same interface:
 * - local files under web/.data (the default when GCS_BUCKET is not set; /tmp/proving-ground on Vercel,
 *   which only survives for the life of one instance, so production needs GCS);
 * - Google Cloud Storage, reached keylessly: the function's Vercel OIDC token is exchanged at Google's STS
 *   for an access token through a workload identity provider (GCS_WIF_AUDIENCE). Scripts that run on a
 *   laptop can use GCS_AUTH=gcloud (an access token from the signed-in gcloud CLI) or GCS_ACCESS_TOKEN.
 *
 * Every read returns a generation and every write may demand one (`ifGenerationMatch`; "0" means "must not
 * exist yet"), so two advancers can never overwrite each other's update: the loser gets a
 * PreconditionFailed and re-reads.
 */

export type Got = { body: Buffer; contentType: string; generation: string };
export type PutOptions = { contentType?: string; ifGenerationMatch?: string; cacheControl?: string };

export interface Store {
  readonly kind: "local" | "gcs";
  get(key: string): Promise<Got | null>;
  put(key: string, body: Buffer | string, opts?: PutOptions): Promise<{ generation: string }>;
  list(prefix: string, limit?: number): Promise<string[]>;
  delete(key: string): Promise<void>;
  getJSON<T>(key: string): Promise<{ value: T; generation: string } | null>;
  putJSON(key: string, value: unknown, opts?: { ifGenerationMatch?: string }): Promise<{ generation: string }>;
}

export class PreconditionFailed extends Error {
  readonly code = "precondition";
  constructor(key: string) {
    super(`The record ${key} changed while it was being updated.`);
  }
}

export const isPreconditionFailed = (e: unknown): e is PreconditionFailed =>
  e instanceof PreconditionFailed || (typeof e === "object" && e !== null && (e as { code?: string }).code === "precondition");

/** Keys are plain relative paths: letters, digits, dot, dash, underscore and slashes; no "..". */
export function assertKey(key: string): void {
  if (!/^[A-Za-z0-9._\-/]{1,300}$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`Bad storage key: ${JSON.stringify(key).slice(0, 80)}`);
  }
}

function withJSON(base: Omit<Store, "getJSON" | "putJSON">): Store {
  return {
    ...base,
    async getJSON<T>(key: string) {
      const g = await base.get(key);
      if (!g) return null;
      return { value: JSON.parse(g.body.toString("utf8")) as T, generation: g.generation };
    },
    async putJSON(key, value, opts = {}) {
      return base.put(key, JSON.stringify(value), { contentType: "application/json", ifGenerationMatch: opts.ifGenerationMatch, cacheControl: "no-store" });
    },
  } as Store;
}

/* ───────────────────────── local files ───────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function localStore(root: string): Store {
  const file = (key: string) => path.join(root, ...key.split("/"));
  const metaFile = (key: string) => file(key) + ".__meta";
  type Meta = { generation: string; contentType: string };

  async function readMeta(key: string): Promise<Meta | null> {
    try {
      return JSON.parse(await fs.readFile(metaFile(key), "utf8")) as Meta;
    } catch {
      return null;
    }
  }

  /** A cross-process mutex per key: an exclusive-create lock file, broken when older than 10 s. */
  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lock = file(key) + ".__lock";
    await fs.mkdir(path.dirname(lock), { recursive: true });
    for (let i = 0; ; i++) {
      try {
        const h = await fs.open(lock, "wx");
        await h.close();
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          const st = await fs.stat(lock);
          if (Date.now() - st.mtimeMs > 10_000) await fs.rm(lock, { force: true });
        } catch {
          /* gone already */
        }
        if (i > 2000) throw new Error(`Timed out waiting for the lock on ${key}`);
        await sleep(5 + Math.random() * 10);
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lock, { force: true });
    }
  }

  return withJSON({
    kind: "local",
    async get(key) {
      assertKey(key);
      try {
        const [body, meta] = await Promise.all([fs.readFile(file(key)), readMeta(key)]);
        return { body, contentType: meta?.contentType ?? "application/octet-stream", generation: meta?.generation ?? "1" };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async put(key, body, opts = {}) {
      assertKey(key);
      return withLock(key, async () => {
        const meta = await readMeta(key);
        let exists = true;
        try {
          await fs.access(file(key));
        } catch {
          exists = false;
        }
        const current = exists ? (meta?.generation ?? "1") : "0";
        if (opts.ifGenerationMatch !== undefined && opts.ifGenerationMatch !== current) throw new PreconditionFailed(key);
        const generation = String(Math.max(Number(current) + 1, Date.now() * 1000 + Math.floor(Math.random() * 1000)));
        await fs.mkdir(path.dirname(file(key)), { recursive: true });
        const tmp = `${file(key)}.__tmp${process.pid}${Math.random().toString(36).slice(2, 8)}`;
        await fs.writeFile(tmp, body);
        await fs.rename(tmp, file(key));
        await fs.writeFile(metaFile(key), JSON.stringify({ generation, contentType: opts.contentType ?? "application/octet-stream" }));
        return { generation };
      });
    },
    async list(prefix, limit = 10_000) {
      const out: string[] = [];
      async function walk(dir: string, rel: string) {
        let entries: import("node:fs").Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const k = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(path.join(dir, e.name), k);
          else if (!/\.__(meta|lock|tmp)/.test(e.name) && k.startsWith(prefix)) out.push(k);
          if (out.length >= limit) return;
        }
      }
      await walk(root, "");
      return out.sort().slice(0, limit);
    },
    async delete(key) {
      assertKey(key);
      await fs.rm(file(key), { force: true });
      await fs.rm(metaFile(key), { force: true });
    },
  });
}

/* ───────────────────────── Google Cloud Storage ───────────────────────── */

let cachedToken: { value: string; exp: number } | null = null;

async function vercelOidcToken(): Promise<string> {
  try {
    const mod = (await import("@vercel/oidc").catch(() => null)) as { getVercelOidcToken?: () => Promise<string> } | null;
    if (mod?.getVercelOidcToken) return await mod.getVercelOidcToken();
  } catch {
    /* fall through to the env var */
  }
  const t = process.env.VERCEL_OIDC_TOKEN;
  if (!t) throw new Error("VERCEL_OIDC_TOKEN is not set (enable OIDC federation on the Vercel project)");
  return t;
}

async function federatedToken(audience: string): Promise<{ value: string; exp: number }> {
  const r = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/devstorage.read_write",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken: await vercelOidcToken(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`GCS federation failed: HTTP ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  return { value: j.access_token, exp: Math.floor(Date.now() / 1000) + j.expires_in };
}

function gcloudToken(): Promise<{ value: string; exp: number }> {
  const bin = process.env.GCLOUD_BIN || (process.platform === "win32" ? "gcloud.cmd" : "gcloud");
  return new Promise((resolve, reject) => {
    execFile(bin, ["auth", "print-access-token"], { shell: process.platform === "win32", timeout: 30_000 }, (err, stdout) => {
      if (err) return reject(new Error("gcloud auth print-access-token failed (is gcloud signed in?)"));
      resolve({ value: stdout.trim(), exp: Math.floor(Date.now() / 1000) + 50 * 60 });
    });
  });
}

async function accessToken(): Promise<string> {
  if (process.env.GCS_ACCESS_TOKEN) return process.env.GCS_ACCESS_TOKEN;
  if (cachedToken && cachedToken.exp - 300 > Date.now() / 1000) return cachedToken.value;
  if (process.env.GCS_AUTH === "gcloud") cachedToken = await gcloudToken();
  else if (process.env.GCS_WIF_AUDIENCE) cachedToken = await federatedToken(process.env.GCS_WIF_AUDIENCE);
  else throw new Error("GCS is configured without credentials: set GCS_WIF_AUDIENCE (Vercel) or GCS_AUTH=gcloud (scripts)");
  return cachedToken.value;
}

export function gcsStore(bucket: string): Store {
  const b = encodeURIComponent(bucket);
  const base = `https://storage.googleapis.com/storage/v1/b/${b}/o`;
  const upload = `https://storage.googleapis.com/upload/storage/v1/b/${b}/o`;
  const auth = async () => ({ authorization: `Bearer ${await accessToken()}` });

  return withJSON({
    kind: "gcs",
    async get(key) {
      assertKey(key);
      const r = await fetch(`${base}/${encodeURIComponent(key)}?alt=media`, { headers: await auth(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Storage read failed for ${key}: HTTP ${r.status}`);
      return {
        body: Buffer.from(await r.arrayBuffer()),
        contentType: r.headers.get("content-type") ?? "application/octet-stream",
        generation: r.headers.get("x-goog-generation") ?? "1",
      };
    },
    async put(key, body, opts = {}) {
      assertKey(key);
      const q = new URLSearchParams({ uploadType: "media", name: key });
      if (opts.ifGenerationMatch !== undefined) q.set("ifGenerationMatch", opts.ifGenerationMatch);
      const buf = typeof body === "string" ? Buffer.from(body) : body;
      const r = await fetch(`${upload}?${q}`, {
        method: "POST",
        headers: { ...(await auth()), "content-type": opts.contentType ?? "application/octet-stream" },
        body: new Uint8Array(buf),
        signal: AbortSignal.timeout(60_000),
      });
      if (r.status === 412) throw new PreconditionFailed(key);
      if (!r.ok) throw new Error(`Storage write failed for ${key}: HTTP ${r.status}`);
      const j = (await r.json()) as { generation?: string };
      if (opts.cacheControl) {
        // metadata patch; best effort (reads go through our proxy, which sets its own headers)
        await fetch(`${base}/${encodeURIComponent(key)}`, {
          method: "PATCH",
          headers: { ...(await auth()), "content-type": "application/json" },
          body: JSON.stringify({ cacheControl: opts.cacheControl }),
          signal: AbortSignal.timeout(15_000),
        }).catch(() => undefined);
      }
      return { generation: String(j.generation ?? "1") };
    },
    async list(prefix, limit = 10_000) {
      const out: string[] = [];
      let pageToken: string | undefined;
      do {
        const q = new URLSearchParams({ prefix, maxResults: String(Math.min(1000, limit - out.length)), fields: "items(name),nextPageToken" });
        if (pageToken) q.set("pageToken", pageToken);
        const r = await fetch(`${base}?${q}`, { headers: await auth(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
        if (!r.ok) throw new Error(`Storage list failed for ${prefix}: HTTP ${r.status}`);
        const j = (await r.json()) as { items?: { name: string }[]; nextPageToken?: string };
        out.push(...(j.items ?? []).map((i) => i.name));
        pageToken = j.nextPageToken;
      } while (pageToken && out.length < limit);
      return out;
    },
    async delete(key) {
      assertKey(key);
      const r = await fetch(`${base}/${encodeURIComponent(key)}`, { method: "DELETE", headers: await auth(), signal: AbortSignal.timeout(15_000) });
      if (!r.ok && r.status !== 404) throw new Error(`Storage delete failed for ${key}: HTTP ${r.status}`);
    },
  });
}

/* ───────────────────────── choice ───────────────────────── */

let chosen: Store | undefined;

export function defaultLocalRoot(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.env.VERCEL) return "/tmp/proving-ground";
  return path.join(process.cwd(), ".data");
}

/** The configured store: GCS when GCS_BUCKET is set, else local files. */
export function store(): Store {
  if (chosen) return chosen;
  chosen = process.env.GCS_BUCKET ? gcsStore(process.env.GCS_BUCKET) : localStore(defaultLocalRoot());
  return chosen;
}

/** Tests and scripts can swap the store. */
export function setStore(s: Store | undefined): void {
  chosen = s;
}

/** Retries a read-modify-write until it lands (generation-match), up to `tries` times. */
export async function updateJSON<T>(s: Store, key: string, init: () => T, mutate: (v: T) => T | Promise<T>, tries = 12): Promise<T> {
  for (let i = 0; ; i++) {
    const cur = await s.getJSON<T>(key);
    const next = await mutate(cur ? cur.value : init());
    try {
      await s.putJSON(key, next, { ifGenerationMatch: cur ? cur.generation : "0" });
      return next;
    } catch (e) {
      if (!isPreconditionFailed(e) || i >= tries - 1) throw e;
      await sleep(20 + Math.random() * 80 * (i + 1));
    }
  }
}
