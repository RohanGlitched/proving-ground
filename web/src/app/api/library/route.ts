import { store } from "@/lib/storage";
import { readLibrary, type LibraryDoc } from "@/lib/pipeline/library";
import { errorResponse, json } from "@/lib/pipeline/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { at: number; doc: LibraryDoc } | null = null;

/** GET /api/library?kind=&source= → { items: LibraryEntry[], updatedAt } (cached 30 s). */
export async function GET(req: Request) {
  try {
    if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), doc: await readLibrary(store()) };
    const u = new URL(req.url);
    const kind = u.searchParams.get("kind");
    const source = u.searchParams.get("source");
    const items = cache.doc.items.filter((i) => (!kind || i.kind === kind) && (!source || i.source === source));
    return json({ items, updatedAt: cache.doc.updatedAt }, 200, { "cache-control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120" });
  } catch (e) {
    return errorResponse(e);
  }
}
