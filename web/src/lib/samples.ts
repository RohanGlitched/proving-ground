// The object the home page uses to show the pipeline: a part-split library object, so the split
// step shows real Lux3D parts. Resolved from the live library at runtime.
import { getLibrary, objectUrl, type LibraryEntry } from "./client/api";

export const SHOWCASE = {
  slug: "kitchen-chair",
  prompt: "a simple wooden kitchen chair with four legs",
};

let pick: Promise<{ url: string; entry: LibraryEntry } | null> | null = null;
export function showcase() {
  if (!pick) {
    pick = getLibrary()
      .then((items) => {
        const e =
          items.find((i) => i.slug === SHOWCASE.slug) ??
          items.filter((i) => i.kind === "object" && i.parts > 2).sort((a, b) => b.parts - a.parts)[0] ??
          items[0];
        return e ? { url: objectUrl(e.id, "visual.glb"), entry: e } : null;
      })
      .catch(() => null);
  }
  return pick;
}
