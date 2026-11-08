import { store as defaultStore, updateJSON, type Store } from "../storage";

/** Everything the UI needs to show and place an object; stored at objects/{id}/meta.json. */
export type ObjectMeta = {
  id: string;
  slug?: string;
  name: string;
  kind: "object" | "pedestrian" | "articulated";
  source: "text" | "photo" | "library";
  category?: string;
  prompt?: string;
  style?: string;
  motion?: string;
  version?: string;
  /** Both files use this frame: Y-up, metres, origin at the bounding-box centre Lux3D chose. */
  up: "y";
  unit: "m";
  bbox: { min: number[]; max: number[] };
  /** Extent along x, y (height), z in metres. */
  size: [number, number, number];
  parts: number;
  /** m³ (parts.json explains the method); mass = volume × density. */
  volume?: number;
  /** "parts" when part-split succeeded, else why the object is one part. */
  split: string;
  tris: number;
  bytes: { visual: number; parts: number };
  hasInput: boolean;
  createdAt: number;
  credits: number;
  lux3dTasks: Record<string, string>;
  /** Articulated objects: number of joints in parts.json (pivot + axis + limits); urdf = objects/{id}/urdf.zip exists. */
  joints?: number;
  urdf?: boolean;
  /** Pedestrians: the walk clip baked into visual.glb (in place: move the root along the path yourself). */
  animated?: { clip: string; inPlace?: boolean; duration?: number };
};

export type LibraryEntry = Pick<ObjectMeta, "id" | "slug" | "name" | "kind" | "source" | "category" | "size" | "parts" | "volume" | "joints" | "createdAt" | "hasInput" | "style">;
export type LibraryDoc = { items: LibraryEntry[]; updatedAt: number };

export const LIBRARY_KEY = "library.json";

export function toEntry(m: ObjectMeta): LibraryEntry {
  return { id: m.id, slug: m.slug, name: m.name, kind: m.kind, source: m.source, category: m.category, size: m.size, parts: m.parts, volume: m.volume, joints: m.joints, createdAt: m.createdAt, hasInput: m.hasInput, style: m.style };
}

/** Adds (or replaces, by id) an entry in library.json with generation-match. */
export async function appendToLibrary(meta: ObjectMeta, s: Store = defaultStore()): Promise<void> {
  await updateJSON<LibraryDoc>(
    s,
    LIBRARY_KEY,
    () => ({ items: [], updatedAt: 0 }),
    (doc) => {
      const e = toEntry(meta);
      const i = doc.items.findIndex((x) => x.id === e.id || (e.slug && x.slug === e.slug));
      if (i >= 0) doc.items[i] = e;
      else doc.items.push(e);
      doc.updatedAt = Date.now();
      return doc;
    },
    30,
  );
}

export async function readLibrary(s: Store = defaultStore()): Promise<LibraryDoc> {
  return (await s.getJSON<LibraryDoc>(LIBRARY_KEY))?.value ?? { items: [], updatedAt: 0 };
}
