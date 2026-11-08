import { store as defaultStore, updateJSON, type Store } from "../storage";
import { newId } from "./config";
import { InputError, isBlocked, normaliseText } from "./validate";

/**
 * Saved courses: a JSON layout of placed objects, a goal, a robot start and a mode. Stored at
 * courses/{id}.json, aggregate results at courses/{id}.stats.json and the list at courses/index.json.
 */

export const MAX_COURSE_BYTES = 50 * 1024;
export const MAX_COURSE_OBJECTS = 80;

export type CourseStats = { runs: number; trials: number; passes: number; bestPassRate: number | null; worstPassRate: number | null; lastSeed?: number; updatedAt: number };
export type CourseIndexEntry = { id: string; title: string; createdAt: number; objects: number; mode?: string; runs: number; trials: number; meanPassRate: number | null; bestPassRate: number | null };
type CourseIndex = { items: CourseIndexEntry[]; updatedAt: number };
export type StoredCourse = Record<string, unknown> & { id: string; title: string; createdAt: number; objects: unknown[] };

const INDEX_KEY = "courses/index.json";
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Checks a course body and returns a cleaned copy. Unknown fields are kept (within the size cap). */
export function validateCourse(raw: unknown, byteLength: number): Omit<StoredCourse, "id" | "createdAt"> {
  if (byteLength > MAX_COURSE_BYTES) throw new InputError("That course is too large to save (50 KB at most).", 413);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InputError("A course must be a JSON object.");
  const c = { ...(raw as Record<string, unknown>) };
  delete c.id;
  delete c.createdAt;
  const title = normaliseText(typeof c.title === "string" ? c.title : "") || "Untitled course";
  if (title.length > 60) throw new InputError("Please keep the course title under 60 characters.");
  if (isBlocked(title)) throw new InputError("That title isn't allowed here.");
  if (c.author !== undefined) {
    if (typeof c.author !== "string" || c.author.length > 30 || isBlocked(c.author)) throw new InputError("Please use a short, friendly author name.");
  }
  if (!Array.isArray(c.objects)) throw new InputError("A course needs an objects list.");
  if (c.objects.length > MAX_COURSE_OBJECTS) throw new InputError(`A course can hold at most ${MAX_COURSE_OBJECTS} objects.`);
  for (const o of c.objects) {
    if (!o || typeof o !== "object") throw new InputError("Each placed object must be a JSON object.");
    const id = (o as { objectId?: unknown }).objectId;
    if (typeof id !== "string" || !/^[0-9a-z_-]{2,40}$/.test(id)) throw new InputError("Each placed object needs a valid objectId.");
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "number" && !Number.isFinite(v)) throw new InputError(`Placed object field ${k} must be a finite number.`);
    }
  }
  for (const k of ["goal", "robotStart"]) {
    const v = c[k];
    if (v !== undefined && (typeof v !== "object" || v === null)) throw new InputError(`${k} must be an object or an array.`);
    if (v && Object.values(v as object).some((x) => typeof x === "number" && !finite(x))) throw new InputError(`${k} must hold finite numbers.`);
  }
  if (c.mode !== undefined && (typeof c.mode !== "string" || c.mode.length > 16)) throw new InputError("mode must be a short string.");
  return { ...c, title, objects: c.objects } as Omit<StoredCourse, "id" | "createdAt">;
}

export async function saveCourse(raw: unknown, byteLength: number, s: Store = defaultStore()): Promise<StoredCourse> {
  const clean = validateCourse(raw, byteLength);
  const course: StoredCourse = { ...clean, id: newId(), createdAt: Date.now() } as StoredCourse;
  await s.putJSON(`courses/${course.id}.json`, course, { ifGenerationMatch: "0" });
  await updateJSON<CourseIndex>(s, INDEX_KEY, () => ({ items: [], updatedAt: 0 }), (idx) => {
    idx.items.push({ id: course.id, title: course.title, createdAt: course.createdAt, objects: course.objects.length, mode: typeof course.mode === "string" ? course.mode : undefined, runs: 0, trials: 0, meanPassRate: null, bestPassRate: null });
    idx.updatedAt = Date.now();
    return idx;
  });
  return course;
}

export async function getCourse(id: string, s: Store = defaultStore()): Promise<{ course: StoredCourse; stats: CourseStats | null } | null> {
  const c = await s.getJSON<StoredCourse>(`courses/${id}.json`);
  if (!c) return null;
  const st = await s.getJSON<CourseStats>(`courses/${id}.stats.json`);
  return { course: c.value, stats: st?.value ?? null };
}

export function validateResult(raw: unknown): { passRate: number; trials: number; seed: number } {
  if (!raw || typeof raw !== "object") throw new InputError("A result must be a JSON object.");
  const { passRate, trials, seed } = raw as Record<string, unknown>;
  if (!finite(passRate) || (passRate as number) < 0 || (passRate as number) > 1) throw new InputError("passRate must be between 0 and 1.");
  if (!Number.isInteger(trials) || (trials as number) < 1 || (trials as number) > 1000) throw new InputError("trials must be a whole number from 1 to 1000.");
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 2 ** 32 - 1) throw new InputError("seed must be a whole number from 0 to 4294967295.");
  // pass rate must be reachable with that many trials (k / trials)
  const k = Math.round((passRate as number) * (trials as number));
  if (Math.abs(k / (trials as number) - (passRate as number)) > 1e-6) throw new InputError("passRate must be passes ÷ trials.");
  return { passRate: passRate as number, trials: trials as number, seed: seed as number };
}

export async function postResult(id: string, raw: unknown, s: Store = defaultStore()): Promise<CourseStats> {
  const r = validateResult(raw);
  if (!(await s.get(`courses/${id}.json`))) throw new InputError("No such course.", 404);
  const passes = Math.round(r.passRate * r.trials);
  const stats = await updateJSON<CourseStats>(
    s,
    `courses/${id}.stats.json`,
    () => ({ runs: 0, trials: 0, passes: 0, bestPassRate: null, worstPassRate: null, updatedAt: 0 }),
    (st) => {
      st.runs += 1;
      st.trials += r.trials;
      st.passes += passes;
      st.bestPassRate = st.bestPassRate === null ? r.passRate : Math.max(st.bestPassRate, r.passRate);
      st.worstPassRate = st.worstPassRate === null ? r.passRate : Math.min(st.worstPassRate, r.passRate);
      st.lastSeed = r.seed;
      st.updatedAt = Date.now();
      return st;
    },
  );
  await updateJSON<CourseIndex>(s, INDEX_KEY, () => ({ items: [], updatedAt: 0 }), (idx) => {
    const e = idx.items.find((x) => x.id === id);
    if (e) {
      e.runs = stats.runs;
      e.trials = stats.trials;
      e.meanPassRate = stats.trials ? Math.round((stats.passes / stats.trials) * 1000) / 1000 : null;
      e.bestPassRate = stats.bestPassRate;
    }
    idx.updatedAt = Date.now();
    return idx;
  });
  return stats;
}

export async function listCourses(sort: "hardest" | "new", limit = 50, s: Store = defaultStore()): Promise<CourseIndexEntry[]> {
  const idx = (await s.getJSON<CourseIndex>(INDEX_KEY))?.value?.items ?? [];
  const items = [...idx];
  if (sort === "hardest") {
    items.sort((a, b) => {
      if ((a.meanPassRate === null) !== (b.meanPassRate === null)) return a.meanPassRate === null ? 1 : -1;
      if (a.meanPassRate !== b.meanPassRate) return (a.meanPassRate ?? 1) - (b.meanPassRate ?? 1);
      return b.trials - a.trials;
    });
  } else items.sort((a, b) => b.createdAt - a.createdAt);
  return items.slice(0, limit);
}
