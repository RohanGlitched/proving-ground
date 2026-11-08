// The object the home page uses to show the pipeline. Swapped to a library object once the
// library is generated (it must be a part-split object so the split step shows real parts).
export const SHOWCASE = {
  visual: process.env.NEXT_PUBLIC_SHOWCASE_GLB ?? "/dev/chair-parts.glb",
  prompt: "a simple wooden kitchen chair with four legs",
};
