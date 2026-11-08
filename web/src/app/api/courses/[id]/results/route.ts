import { store } from "@/lib/storage";
import { isId } from "@/lib/pipeline/config";
import { postResult } from "@/lib/pipeline/courses";
import { errorResponse, json } from "@/lib/pipeline/http";
import { clientIp, hashIp, takeSlot } from "@/lib/pipeline/limits";
import { InputError } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/courses/:id/results { passRate 0..1, trials 1..1000, seed 0..2^32-1 } → { stats } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isId(id)) return json({ error: "No such course." }, 404);
    const text = await req.text();
    if (text.length > 2048) throw new InputError("Result too large.", 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new InputError("The result must be JSON.");
    }
    if (!(await takeSlot("results", hashIp(clientIp(req.headers)), 60, store()))) return json({ error: "Too many results this hour." }, 429);
    return json({ stats: await postResult(id, body, store()) });
  } catch (e) {
    return errorResponse(e);
  }
}
