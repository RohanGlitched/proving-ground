// Robot-ready pack, built in the browser: the textured GLB, one STL hull per part, an MJCF body
// with masses, and the metadata. Same data the arena's physics uses.
import { zipSync, strToU8 } from "fflate";
import { toMJCF } from "@/sim/assets";
import { getPhysics, objectUrl, type LibraryEntry } from "./api";
import { defaultDensity } from "@/lib/density";

export async function buildPack(e: LibraryEntry, density = defaultDensity(e)) {
  const [phys, visual, meta] = await Promise.all([
    getPhysics(e.id),
    fetch(objectUrl(e.id, "visual.glb")).then((r) => r.arrayBuffer()),
    fetch(objectUrl(e.id, "meta.json")).then((r) => r.text()),
  ]);
  const parts = phys.parts;
  // the same mass the arena uses: closed mesh volume × density (hull volume overstates hollow shapes)
  const mj = toMJCF({ name: e.slug ?? e.name, parts, density, mass: phys.volume ? phys.volume * density : undefined, joints: phys.joints });
  const readme = `${e.name}
Made with Aholo Lux3D in Proving Ground.

visual.glb   textured mesh, metres, Y-up (glTF convention)
object.xml   MuJoCo include: ${phys.joints?.length ? `a fixed base with ${phys.joints.length} moving part${phys.joints.length === 1 ? "" : "s"} on Lux3D's joints (hinge or slide, with limits)` : `a free body with ${parts.length} convex mesh geoms`}, ${mj.mass.toFixed(2)} kg total
             (density ${density} kg/m^3 over the closed mesh volume), Z-up, no floor. Add it to your own
             scene with <include file="object.xml"/>.
scene.xml    a floor plus the object: mujoco.MjModel.from_xml_path("scene.xml")
meshes/      one convex hull per Lux3D part, binary STL, metres, Z-up
meta.json    size, source and Lux3D task ids

Size: ${(e.size[0] * 100).toFixed(0)} x ${(e.size[2] * 100).toFixed(0)} x ${(e.size[1] * 100).toFixed(0)} cm (width x depth x height, as on the site)
`;
  const files: Record<string, Uint8Array> = {
    "visual.glb": new Uint8Array(visual),
    "object.xml": strToU8(mj.xml),
    "scene.xml": strToU8(mj.scene),
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
