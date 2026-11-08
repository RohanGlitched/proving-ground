import { after } from "next/server";
import { store } from "@/lib/storage";
import { config, isId } from "@/lib/pipeline/config";
import { advanceJob, EXPORT_FORMATS, exportKey, isExportFormat, startExport } from "@/lib/pipeline/jobs";
import { cachedCredits, errorResponse, json } from "@/lib/pipeline/http";
import { clientIp, hashIp, takeSlot } from "@/lib/pipeline/limits";
import { InputError } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/objects/:id/export { format: "stl" | "3mf" | "usdz" | "fbx_zip" | "obj_zip" }
 *   → { status: "done", url } when the file exists, else 202 { status: "queued", jobId } (poll /api/jobs/:jobId;
 *     when it is done, GET /api/objects/:id/export/:format). Lux3D multi-format export, 1 credit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isId(id)) return json({ error: "No such object." }, 404);
    let body: { format?: unknown };
    try {
      body = (await req.json()) as { format?: unknown };
    } catch {
      throw new InputError("Send JSON: { format }.");
    }
    if (!isExportFormat(body.format)) throw new InputError(`format must be one of: ${Object.keys(EXPORT_FORMATS).join(", ")}.`);
    const format = body.format;
    const s = store();
    if (!(await s.getJSON(`objects/${id}/meta.json`))) return json({ error: "No such object." }, 404);
    const url = `/api/objects/${id}/export/${format}`;
    if ((await s.list(exportKey(id, format), 1)).includes(exportKey(id, format))) return json({ status: "done", url });

    if (config.paused) return json({ error: "Exports are paused for now." }, 503);
    const credits = await cachedCredits();
    if (credits !== null && credits < Math.min(50, config.minCredits)) return json({ error: "The Lux3D credit pool is empty, so exports are paused." }, 503);
    if (!(await takeSlot("exports", hashIp(clientIp(req.headers)), Math.max(6, config.perIpHour * 2), s)))
      return json({ error: "You've asked for a lot of exports this hour. Try again later." }, 429);

    const { jobId } = await startExport(id, format, { store: s, now: Date.now });
    after(async () => {
      try {
        await advanceJob(jobId, { budgetMs: 45_000 });
      } catch {
        /* the next poll carries on */
      }
    });
    return json({ status: "queued", jobId, url }, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
