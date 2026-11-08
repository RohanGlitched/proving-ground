import { store } from "@/lib/storage";
import { listCourses, MAX_COURSE_BYTES, saveCourse } from "@/lib/pipeline/courses";
import { errorResponse, json } from "@/lib/pipeline/http";
import { clientIp, hashIp, takeSlot } from "@/lib/pipeline/limits";
import { InputError } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/courses (JSON course ≤ 50 KB) → 201 { id } */
export async function POST(req: Request) {
  try {
    const text = await req.text();
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_COURSE_BYTES) throw new InputError("That course is too large to save (50 KB at most).", 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new InputError("The course must be JSON.");
    }
    if (!(await takeSlot("courses", hashIp(clientIp(req.headers)), 20, store())))
      return json({ error: "You've saved a lot of courses this hour. Try again later." }, 429);
    const c = await saveCourse(body, bytes, store());
    return json({ id: c.id }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/courses?sort=hardest|new&limit=50 → { items: CourseIndexEntry[] } */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const sort = u.searchParams.get("sort") === "hardest" ? "hardest" : "new";
    const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit")) || 50));
    return json({ items: await listCourses(sort, limit, store()) }, 200, { "cache-control": "public, max-age=15, s-maxage=15" });
  } catch (e) {
    return errorResponse(e);
  }
}
