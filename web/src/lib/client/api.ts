// Browser-side calls to our API. Types mirror src/lib/pipeline (kept structural so this file
// never imports server code into the client bundle).
import type { ArticulationJoint, CollisionPart } from "@/sim/types";

export type LibraryEntry = {
  id: string;
  slug?: string;
  name: string;
  kind: "object" | "pedestrian" | "articulated";
  source: "text" | "photo" | "library";
  category?: string;
  size: [number, number, number]; // x, y (height), z in metres
  parts: number;
  createdAt: number;
  hasInput: boolean;
  style?: string;
};

export type JobStage = { name: string; status: "pending" | "running" | "done" | "skipped" | "failed"; note?: string; startedAt?: number; endedAt?: number };
export type PublicJob = {
  id: string;
  kind: string;
  source: string;
  input: { text?: string; style?: string; label?: string; motion?: string };
  status: "queued" | "running" | "done" | "failed";
  queuePosition: number | null;
  stages: JobStage[];
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  etaSeconds: number;
  error?: string;
  result?: { objectId: string };
  credits: number;
};

export type PartsDoc = {
  version: 1;
  up: "y";
  unit: "m";
  source: "part-split" | "whole";
  bbox: { min: number[]; max: number[] };
  parts: { name: string; count: number; points: number[]; volume?: number }[];
};

export const objectUrl = (id: string, file: "visual.glb" | "parts.json" | "meta.json" | "input.jpg" | "thumb.webp") => `/api/objects/${id}/${file}`;

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${r.status})`);
  return body as T;
}

export async function getLibrary(): Promise<LibraryEntry[]> {
  const d = await json<{ items: LibraryEntry[] }>(await fetch("/api/library", { cache: "no-store" }));
  return d.items ?? [];
}

/** Photos should go through shrinkPhoto first: Vercel refuses request bodies over 4.5 MB. */
export async function makeObject(input: { text?: string; image?: Blob; style?: string; kind?: string; label?: string }) {
  const fd = new FormData();
  if (input.text) fd.set("text", input.text);
  if (input.image) fd.set("image", input.image, "photo.jpg");
  if (input.style) fd.set("style", input.style);
  fd.set("kind", input.kind ?? "object");
  if (input.label) fd.set("label", input.label);
  fd.set("website", ""); // honeypot stays empty
  return json<{ jobId: string; job?: PublicJob }>(await fetch("/api/make", { method: "POST", body: fd }));
}

export async function getJob(id: string) {
  const d = await json<PublicJob | { job: PublicJob }>(await fetch(`/api/jobs/${id}`, { cache: "no-store" }));
  return ("job" in d ? d.job : d) as PublicJob;
}

export async function getStatus() {
  return json<{ queueLength: number; activeJob?: string | null; credits?: number | null; dailyRemaining?: number }>(await fetch("/api/status", { cache: "no-store" }));
}

/** Parts arrive Y-up (Lux3D). The sim wants Z-up: (x, y, z)_yup -> (x, -z, y)_zup. */
export async function getParts(id: string): Promise<CollisionPart[]> {
  return (await getPhysics(id)).parts;
}

const physicsCache = new Map<string, Promise<{ parts: CollisionPart[]; volume: number | null; joints?: ArticulationJoint[] }>>();
/** Collision parts plus the closed-mesh volume (m³) when the pipeline measured it. Mass = volume × density. */
export function getPhysics(id: string) {
  let p = physicsCache.get(id);
  if (!p) {
    p = fetch(objectUrl(id, "parts.json"))
      .then((r) => json<PartsDoc & { volume?: number; joints?: ArticulationJoint[] }>(r))
      .then((doc) => ({
        parts: convertParts(doc),
        volume: typeof doc.volume === "number" && doc.volume > 0 ? doc.volume : null,
        ...(doc.joints?.length ? { joints: doc.joints } : {}),
      }));
    p.catch(() => physicsCache.delete(id));
    physicsCache.set(id, p);
  }
  return p;
}

function convertParts(doc: PartsDoc): CollisionPart[] {
  return doc.parts.map((p) => {
    const src = p.points;
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      out[i] = src[i];
      out[i + 1] = -src[i + 2];
      out[i + 2] = src[i + 1];
    }
    return { points: out, name: p.name, ...(p.volume && p.volume > 0 ? { meshVolume: p.volume } : {}) };
  });
}

export type CourseDoc = {
  title: string;
  objects: { objectId: string; name: string; x: number; y: number; yaw: number; density?: number; kind?: "object" | "mover" }[];
  start: { x: number; y: number; yaw: number };
  goal: { x: number; y: number };
  mode: "blind" | "planner";
  pushes?: boolean;
  best?: { passRate: number; trials: number; seed: number } | null;
};

export async function saveCourse(c: CourseDoc) {
  return json<{ id: string }>(await fetch("/api/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }));
}

export async function loadCourse(id: string) {
  return json<{ course: CourseDoc & { id: string; createdAt: number }; stats: { runs: number; trials: number; passes: number; bestPassRate: number | null } | null }>(
    await fetch(`/api/courses/${id}`, { cache: "no-store" }),
  );
}

export async function postResult(id: string, r: { passRate: number; trials: number; seed: number; mode: string }) {
  return json<unknown>(await fetch(`/api/courses/${id}/results`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r) }));
}

export async function listCourses(sort: "hardest" | "new" = "hardest") {
  return json<{ items: { id: string; title: string; createdAt: number; objects: number; runs: number; trials: number; meanPassRate: number | null; bestPassRate: number | null }[] }>(
    await fetch(`/api/courses?sort=${sort}`, { cache: "no-store" }),
  );
}
