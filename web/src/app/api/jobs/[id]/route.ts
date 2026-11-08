import { store } from "@/lib/storage";
import { isId } from "@/lib/pipeline/config";
import { advanceJob, publicJob, readQueue } from "@/lib/pipeline/jobs";
import { errorResponse, json } from "@/lib/pipeline/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/jobs/:id → PublicJob. Polling is what moves the pipeline; poll every 3 s. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isId(id)) return json({ error: "No such job." }, 404);
    const job = await advanceJob(id, { budgetMs: 50_000 });
    if (!job) return json({ error: "No such job." }, 404);
    return json(publicJob(job, await readQueue(store())));
  } catch (e) {
    return errorResponse(e);
  }
}
