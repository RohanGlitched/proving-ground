import { store } from "@/lib/storage";
import { isId } from "@/lib/pipeline/config";
import { errorResponse, json } from "@/lib/pipeline/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES: Record<string, { key: (id: string) => string; type: string }> = {
  "visual.glb": { key: (id) => `objects/${id}/visual.glb`, type: "model/gltf-binary" },
  "parts.json": { key: (id) => `objects/${id}/parts.json`, type: "application/json" },
  "meta.json": { key: (id) => `objects/${id}/meta.json`, type: "application/json" },
  "urdf.zip": { key: (id) => `objects/${id}/urdf.zip`, type: "application/zip" },
  "input.jpg": { key: (id) => `inputs/${id}.jpg`, type: "image/jpeg" },
  "thumb.webp": { key: (id) => `objects/${id}/thumb.webp`, type: "image/webp" },
};

/** GET /api/objects/:id/(visual.glb|parts.json|meta.json|input.jpg|thumb.webp). Files can be reprocessed (size check, thumbnails),
 * so browsers keep them an hour; the CDN keeps them until the next deploy, which clears its cache. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  try {
    const { id, file } = await ctx.params;
    const f = FILES[file];
    if (!f || !isId(id)) return json({ error: "Not found." }, 404);
    // input photos are only served once their object is published
    if (file === "input.jpg" && !(await store().get(`objects/${id}/meta.json`))) return json({ error: "Not found." }, 404);
    const g = await store().stream(f.key(id));
    if (!g) return json({ error: "Not found." }, 404);
    return new Response(g.body, {
      headers: {
        "content-type": f.type,
        ...(g.size ? { "content-length": String(g.size) } : {}),
        "cache-control": "public, max-age=3600, s-maxage=31536000",
        "access-control-allow-origin": "*",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
