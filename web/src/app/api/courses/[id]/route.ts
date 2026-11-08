import { store } from "@/lib/storage";
import { isId } from "@/lib/pipeline/config";
import { getCourse } from "@/lib/pipeline/courses";
import { errorResponse, json } from "@/lib/pipeline/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/courses/:id → { course, stats } */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isId(id)) return json({ error: "No such course." }, 404);
    const c = await getCourse(id, store());
    if (!c) return json({ error: "No such course." }, 404);
    return json(c, 200, { "cache-control": "public, max-age=10, s-maxage=10" });
  } catch (e) {
    return errorResponse(e);
  }
}
