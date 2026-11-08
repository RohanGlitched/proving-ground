import { store } from "@/lib/storage";
import { isId } from "@/lib/pipeline/config";
import { EXPORT_FORMATS, exportKey, isExportFormat } from "@/lib/pipeline/jobs";
import { errorResponse, json } from "@/lib/pipeline/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/objects/:id/export/:format → the exported file as a download named <slug>.<ext>. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; format: string }> }) {
  try {
    const { id, format } = await ctx.params;
    if (!isId(id) || !isExportFormat(format)) return json({ error: "Not found." }, 404);
    const s = store();
    // streamed: a USDZ can be 6+ MB, over the 4.5 MB a buffered function response may carry
    const g = await s.stream(exportKey(id, format));
    if (!g) return json({ error: "Not exported yet." }, 404);
    const meta = (await s.getJSON<{ slug?: string; name?: string }>(`objects/${id}/meta.json`))?.value;
    const base = (meta?.slug || meta?.name || id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id;
    const f = EXPORT_FORMATS[format];
    return new Response(g.body, {
      headers: {
        "content-type": f.type,
        ...(g.size ? { "content-length": String(g.size) } : {}),
        "content-disposition": `attachment; filename="${base}.${f.ext}"`,
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
