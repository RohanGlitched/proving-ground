import { createHash } from "node:crypto";

/**
 * Typed client for the Aholo Open API (Lux3D + Asset/OUS upload).
 *
 * Facts measured on Nov 9 2026 (probe/): the raw key goes in the Authorization header (no "Bearer"); every
 * file input must first be uploaded through OUS (third-party URLs fail silently with status 4); output URLs
 * expire after about 2 hours; one generation task may run per account at a time.
 *
 * The key never appears in errors or logs: every failure is mapped to a short human sentence.
 */

export const AHOLO_BASE = "https://api.aholo.ai/global";
const LUX = `${AHOLO_BASE}/lux3d/v1`;
const REQUEST_TIMEOUT_MS = 30_000;

export type Version = "G1-Turbo" | "G1";
export type Style = "photorealistic" | "cartoon" | "anime" | "hand_painted" | "cyberpunk" | "fantasy" | "glass";
export const STYLES: Style[] = ["photorealistic", "cartoon", "anime", "hand_painted", "cyberpunk", "fantasy", "glass"];

export type TaskStatus = "running" | "done" | "failed" | "cancelled";
export type TaskOutput = { content: string; isUrl: boolean };
export type Task = { taskId: string; status: TaskStatus; rawStatus: number; outputs: TaskOutput[]; message?: string };

export type CreateRequest =
  | { op: "img-to-3d"; img: string; version?: Version; faceCount?: number }
  | { op: "text-to-3d"; prompt: string; style?: Style; version?: Version; faceCount?: number }
  | { op: "part-split"; glbUrl: string }
  | { op: "rig"; modelUrl: string }
  | { op: "retarget"; rigModelUrl: string; animationIds: string[]; animateInPlace?: boolean }
  | { op: "articulation"; glbUrl: string; prompt: string }
  | { op: "export"; modelUrl: string; outputFormat: string[] };

export type Op = CreateRequest["op"];

/** Credits per call, from the live quote endpoint on Nov 9 2026 (probe/quote.py). */
export const CREDITS: Record<string, number> = {
  "img-to-3d:G1-Turbo": 1,
  "img-to-3d:G1": 20,
  "text-to-3d:G1-Turbo": 13,
  "text-to-3d:G1": 20,
  "part-split": 30,
  rig: 15,
  retarget: 6,
  articulation: 28,
  export: 1,
};

export function creditsFor(req: CreateRequest): number {
  if (req.op === "img-to-3d" || req.op === "text-to-3d") return CREDITS[`${req.op}:${req.version ?? "G1-Turbo"}`] ?? 0;
  return CREDITS[req.op] ?? 0;
}

export class AholoError extends Error {
  /** "concurrency" = another task is running on the account; "credits" = balance too low; others are generic. */
  constructor(
    message: string,
    readonly kind: "concurrency" | "credits" | "auth" | "input" | "network" | "server" | "expired" | "unknown",
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export const isConcurrencyError = (e: unknown) => e instanceof AholoError && e.kind === "concurrency";

/** Maps an envelope code/message to a human sentence without echoing anything sensitive. */
export function mapBusinessError(code: string, message: string | undefined): AholoError {
  const m = `${code} ${message ?? ""}`.toUpperCase();
  if (m.includes("CONCURRENCY")) return new AholoError("Lux3D is busy with another model right now; this one is queued.", "concurrency", true);
  if (m.includes("CREDIT") || m.includes("BALANCE") || m.includes("INSUFFICIENT"))
    return new AholoError("The Lux3D account is out of credits for now.", "credits", false);
  if (m.includes("AUTH") || m.includes("TOKEN") || m.includes("PERMISSION") || m.includes("FORBIDDEN"))
    return new AholoError("Lux3D refused the request (authorisation).", "auth", false);
  if (m.includes("PARAM") || m.includes("INVALID") || m.includes("ILLEGAL") || m.includes("SENSITIVE") || m.includes("AUDIT"))
    return new AholoError("Lux3D could not use that input. Try a clearer photo or a different description.", "input", false);
  return new AholoError("Lux3D returned an error.", "unknown", false);
}

function scrub(s: string): string {
  const key = process.env.AHOLO_API_KEY;
  return key ? s.split(key).join("[key]") : s;
}

export type AholoOptions = { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number };

export class AholoClient {
  private readonly key: string;
  private readonly f: typeof fetch;
  private readonly timeout: number;

  constructor(opts: AholoOptions = {}) {
    const key = opts.apiKey ?? process.env.AHOLO_API_KEY;
    if (!key) throw new AholoError("The Lux3D key is not configured on this server.", "auth", false);
    this.key = key.trim();
    this.f = opts.fetchImpl ?? fetch;
    this.timeout = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** One HTTP call with a timeout; reads (idempotent) retry up to 3 times on network/5xx. */
  private async http(url: string, init: RequestInit & { retry?: boolean; ousToken?: string } = {}): Promise<unknown> {
    const tries = init.retry ? 3 : 1;
    let last: AholoError | null = null;
    for (let i = 0; i < tries; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 600 * 2 ** i));
      let res: Response;
      try {
        const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
        if (init.ousToken) headers["ous-token-v2"] = init.ousToken;
        else headers["Authorization"] = this.key;
        res = await this.f(url, { ...init, headers, signal: AbortSignal.timeout(this.timeout) });
      } catch (e) {
        const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
        last = new AholoError(timedOut ? "Lux3D took too long to answer." : "Could not reach Lux3D.", "network", true);
        continue;
      }
      const text = await res.text();
      if (res.status >= 500) {
        last = new AholoError("Lux3D had a server error.", "server", true);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new AholoError("Lux3D refused the request (authorisation).", "auth", false);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AholoError(`Lux3D sent an unreadable answer (HTTP ${res.status}).`, "server", false);
      }
      const env = json as { c?: unknown; m?: string; d?: unknown; code?: unknown };
      if (env && typeof env === "object" && "c" in env) {
        if (String(env.c) !== "0") throw mapBusinessError(String(env.c), scrub(String(env.m ?? "")));
        return env.d;
      }
      if (!res.ok) throw new AholoError(`Lux3D returned HTTP ${res.status}.`, res.status === 429 ? "concurrency" : "unknown", res.status === 429);
      return json;
    }
    throw last ?? new AholoError("Lux3D request failed.", "unknown", false);
  }

  private postJSON(path: string, body: unknown) {
    return this.http(LUX + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  /* ─────────────── tasks ─────────────── */

  async createTask(req: CreateRequest): Promise<string> {
    let path: string;
    let body: Record<string, unknown>;
    switch (req.op) {
      case "img-to-3d":
        path = "/generate/img-to-3d/task/create";
        body = { img: req.img, version: req.version ?? "G1-Turbo", outputFormat: ["glb"], faceCount: req.faceCount ?? 20000 };
        break;
      case "text-to-3d":
        path = "/generate/text-to-3d/task/create";
        body = { prompt: req.prompt, style: req.style ?? "photorealistic", version: req.version ?? "G1-Turbo", outputFormat: ["glb"], faceCount: req.faceCount ?? 20000 };
        break;
      case "part-split":
        path = "/part-split/task/create";
        body = { glbUrl: req.glbUrl };
        break;
      case "rig":
        path = "/animations/rig/task/create";
        body = { modelUrl: req.modelUrl };
        break;
      case "retarget":
        path = "/animations/retarget/task/create";
        body = { rigModelUrl: req.rigModelUrl, animationIds: req.animationIds, outFormat: "glb", animateInPlace: req.animateInPlace ?? true };
        break;
      case "articulation":
        path = "/articulation-animation/task/create";
        body = { glbUrl: req.glbUrl, prompt: req.prompt };
        break;
      case "export":
        path = "/multi-format-export/task/create";
        body = { modelUrl: req.modelUrl, outputFormat: req.outputFormat };
        break;
    }
    const d = await this.postJSON(path, body);
    const id = typeof d === "object" && d !== null ? ((d as { taskId?: unknown; taskid?: unknown }).taskId ?? (d as { taskid?: unknown }).taskid) : d;
    if (id === undefined || id === null || id === "") throw new AholoError("Lux3D did not return a task id.", "server", false);
    return String(id);
  }

  async getTask(taskId: string): Promise<Task> {
    const d = (await this.http(`${LUX}/generate/task/get?taskid=${encodeURIComponent(taskId)}`, { retry: true })) as {
      status?: number;
      outputs?: { content?: string }[];
      message?: string;
      errorMsg?: string;
    } | null;
    const raw = Number(d?.status ?? -1);
    const status: TaskStatus = raw === 3 ? "done" : raw === 4 ? "failed" : raw === 6 ? "cancelled" : "running";
    const outputs = (d?.outputs ?? [])
      .map((o) => String(o?.content ?? ""))
      .filter(Boolean)
      .map((content) => ({ content, isUrl: /^https?:\/\//.test(content) }));
    return { taskId, status, rawStatus: raw, outputs, message: d?.errorMsg ?? d?.message };
  }

  /* ─────────────── account ─────────────── */

  async balance(): Promise<{ credits: number; uniqueId?: string }> {
    const d = (await this.http(`${LUX}/account/balance?source=100&agentName=proving-ground`, { retry: true })) as {
      availableCredits?: number;
      uniqueId?: string;
    } | null;
    return { credits: Number(d?.availableCredits ?? 0), uniqueId: d?.uniqueId };
  }

  /** Live price for one create call (credits). */
  async quote(req: CreateRequest): Promise<number | null> {
    const { uniqueId } = await this.balance();
    const fake = "https://example.invalid/x";
    const map: Record<Op, [string, unknown]> = {
      "img-to-3d": ["/lux3d/v1/generate/img-to-3d/task/create", { img: fake, version: "version" in req ? req.version : "G1-Turbo", outputFormat: ["glb"] }],
      "text-to-3d": ["/lux3d/v1/generate/text-to-3d/task/create", { prompt: "a chair", version: "version" in req ? req.version : "G1-Turbo", outputFormat: ["glb"] }],
      "part-split": ["/lux3d/v1/part-split/task/create", { glbUrl: fake }],
      rig: ["/lux3d/v1/animations/rig/task/create", { modelUrl: fake }],
      retarget: ["/lux3d/v1/animations/retarget/task/create", { rigModelUrl: fake, animationIds: ["Walk_Loop"], outFormat: "glb" }],
      articulation: ["/lux3d/v1/articulation-animation/task/create", { glbUrl: fake, prompt: "open" }],
      export: ["/lux3d/v1/multi-format-export/task/create", { modelUrl: fake, outputFormat: ["stl"] }],
    };
    const [p, b] = map[req.op];
    const d = (await this.postJSON("/pricing/openapi-quotes", {
      source: 100,
      agentName: "proving-ground",
      uniqueId,
      items: { "1": { endpoint: { method: "POST", path: p }, parameters: { pathParameters: "{}", queryParameters: "{}", body: JSON.stringify(b) } } },
    })) as Record<string, unknown> | null;
    const found = JSON.stringify(d ?? {}).match(/"(?:credits|price|amount|cost)"\s*:\s*(\d+(?:\.\d+)?)/i);
    return found ? Number(found[1]) : null;
  }

  /* ─────────────── Asset / OUS upload ─────────────── */

  /** Uploads bytes through OUS and returns the hosted URL Lux3D accepts as input. */
  async upload(data: Buffer, filename: string, waitMs = 120_000): Promise<string> {
    const md5 = createHash("md5").update(data).digest("hex");
    const tok = (await this.http(`${AHOLO_BASE}/asset/v1/token`, { retry: true })) as { ousToken?: string; globalDomain?: string; blockSize?: number | string };
    if (!tok?.ousToken || !tok.globalDomain) throw new AholoError("Lux3D upload service did not issue a token.", "server", true);
    const token = tok.ousToken;
    const dom = String(tok.globalDomain).replace(/\/+$/, "");
    const blockSize = Number(tok.blockSize) || 4 * 1024 * 1024;
    const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
      this.http(dom + path, { method: "POST", body, headers, ousToken: token });
    const fileBlob = (bytes: Buffer) => new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" });

    if (data.length <= blockSize) {
      const fd = new FormData();
      fd.append("md5", md5);
      fd.append("file", fileBlob(data), filename);
      await post("/ous/api/v2/single/upload", fd);
    } else {
      const blocks = Math.ceil(data.length / blockSize);
      const form = new URLSearchParams({ md5, blocks: String(blocks), size: String(data.length), name: filename });
      const init = ((await post("/ous/api/v2/block/upload/init", form.toString(), { "Content-Type": "application/x-www-form-urlencoded" })) ?? {}) as {
        deduplicated?: boolean;
      };
      if (!init.deduplicated) {
        for (let i = 0; i < blocks; i++) {
          const fd = new FormData();
          fd.append("block", String(i + 1));
          fd.append("file", fileBlob(data.subarray(i * blockSize, (i + 1) * blockSize)), filename);
          await post("/ous/api/v2/block/upload/part", fd);
        }
      }
    }
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      const st = ((await this.http(dom + "/ous/api/v2/upload/status", { ousToken: token, retry: true })) ?? {}) as { status?: number; url?: string };
      if (st.status === 5 && /^https?:\/\//.test(String(st.url ?? ""))) return String(st.url);
      if (st.status === 6 || st.status === 8) throw new AholoError("The upload to Lux3D failed.", "server", true);
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new AholoError("The upload to Lux3D did not finish in time.", "network", true);
  }
}

/** Downloads a Lux3D output URL (they expire after ~2 h). Expired links map to kind "expired". */
export async function downloadOutput(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 120_000): Promise<Buffer> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 403 || r.status === 404 || r.status === 410) throw new AholoError("The Lux3D result link expired before it was collected.", "expired", false);
      if (!r.ok) throw new AholoError(`Downloading the Lux3D result failed (HTTP ${r.status}).`, "network", true);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (e instanceof AholoError && !e.retryable) throw e;
      if (i === 2) throw e instanceof AholoError ? e : new AholoError("Downloading the Lux3D result failed.", "network", true);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new AholoError("Downloading the Lux3D result failed.", "network", true);
}

export function humanError(e: unknown): string {
  if (e instanceof AholoError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  return scrub(msg).slice(0, 200);
}
