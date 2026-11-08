// Robot-ready pack, built in the browser: the textured GLB, one STL hull per part, an MJCF body
// with masses, and the metadata. Same data the arena's physics uses.
import { zipSync, strToU8 } from "fflate";
import { toMJCF } from "@/sim/assets";
import { getParts, objectUrl, type LibraryEntry } from "./api";

export async function buildPack(e: LibraryEntry, density = 400) {
  const [parts, visual, meta] = await Promise.all([
    getParts(e.id),
    fetch(objectUrl(e.id, "visual.glb")).then((r) => r.arrayBuffer()),
    fetch(objectUrl(e.id, "meta.json")).then((r) => r.text()),
  ]);
  const mj = toMJCF({ name: e.slug ?? e.name, parts, density });
  const readme = `${e.name}
Made with Aholo Lux3D in Proving Ground.

visual.glb   textured mesh, metres, Y-up (glTF convention)
object.xml   MuJoCo model: a free body with ${parts.length} convex mesh geoms, ${mj.mass.toFixed(2)} kg total
             (density ${density} kg/m^3 over hull volume), Z-up. Load it with mujoco.MjModel.from_xml_path.
meshes/      one convex hull per Lux3D part, binary STL, metres, Z-up
meta.json    size, source and Lux3D task ids

Size: ${e.size.map((s) => (s * 100).toFixed(0)).join(" x ")} cm (x, height, z)
`;
  const files: Record<string, Uint8Array> = {
    "visual.glb": new Uint8Array(visual),
    "object.xml": strToU8(mj.xml),
    "meta.json": strToU8(meta),
    "README.txt": strToU8(readme),
  };
  for (const [k, v] of Object.entries(mj.files)) files[k] = v;
  const zip = zipSync(files, { level: 6 });
  const blob = new Blob([zip as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(e.slug ?? e.name).replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-robot-pack.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { mass: mj.mass, parts: parts.length };
}
