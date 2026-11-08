import { after } from "next/server";
import { store } from "@/lib/storage";
import { config, newId } from "@/lib/pipeline/config";
import { advanceJob, createJob, publicJob, readQueue } from "@/lib/pipeline/jobs";
import { cachedCredits, errorResponse, json } from "@/lib/pipeline/http";
import { clientIp, hashIp, takeJobSlot } from "@/lib/pipeline/limits";
import { checkHoneypot, checkKind, checkStyle, checkText, cleanImage, InputError, MAX_IMAGE_BYTES } from "@/lib/pipeline/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/make (multipart/form-data)
 *   text?   description, ≤120 chars (required unless an image is sent)
 *   image?  JPEG/PNG/WebP ≤8 MB (Vercel caps request bodies at 4.5 MB, so the UI should downscale first)
 *   style?  photorealistic | cartoon | anime | hand_painted | cyberpunk | fantasy | glass (text only)
 *   kind?   object | pedestrian | articulated (default object)
 *   label?  short display name, ≤40 chars
 *   motion? articulated only: what moves, ≤120 chars
 *   website honeypot, must be empty
 * → 202 { jobId, job, dailyRemaining }
 */
export async function POST(req: Request) {
  try {
    if (config.paused) return json({ error: "Making new objects is paused for now. The library is still open." }, 503);
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_IMAGE_BYTES + 64 * 1024) throw new InputError("The photo is too large; please keep it under 8 MB.", 413);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new InputError("Send the request as multipart/form-data.");
    }
    checkHoneypot(form.get("website"));
    const kind = checkKind(form.get("kind"));
    const image = form.get("image");
    const hasImage = typeof image === "object" && image !== null && typeof (image as Blob).arrayBuffer === "function" && (image as Blob).size > 0;
    const rawText = form.get("text");
    const text = hasImage ? (typeof rawText === "string" && rawText.trim() ? checkText(rawText) : undefined) : checkText(rawText);
    const style = checkStyle(form.get("style"));
    const rawLabel = form.get("label");
    const label = typeof rawLabel === "string" && rawLabel.trim() ? checkText(rawLabel, "label", 40) : undefined;
    const rawMotion = form.get("motion");
    const motion = kind === "articulated" && typeof rawMotion === "string" && rawMotion.trim() ? checkText(rawMotion, "motion") : undefined;
    if (hasImage && kind === "articulated") throw new InputError("Moving objects are made from a description; send text instead of a photo.");

    const credits = await cachedCredits();
    if (credits !== null && credits < config.minCredits)
      return json({ error: "The Lux3D credit pool is nearly empty, so new objects are paused. The library is still open." }, 503);

    const cleaned = hasImage ? (await cleanImage(Buffer.from(await (image as Blob).arrayBuffer()))).jpeg : undefined;

    const ipHash = hashIp(clientIp(req.headers));
    const slot = await takeJobSlot(ipHash, store());
    if (!slot.ok) return json({ error: slot.reason }, 429, { "retry-after": String(slot.retryAfter) });

    const id = newId();
    let imageKey: string | undefined;
    if (cleaned) {
      imageKey = `inputs/${id}.jpg`;
      await store().put(imageKey, cleaned, { contentType: "image/jpeg" });
    }
    const job = await createJob({
      id,
      kind,
      source: hasImage ? "photo" : "text",
      input: { text, style: hasImage ? undefined : style, imageKey, label, motion },
      ipHash,
    });
    after(async () => {
      try {
        await advanceJob(id, { budgetMs: 45_000 });
      } catch (e) {
        console.error("[make] first advance failed", (e as Error)?.message?.slice(0, 120));
      }
    });
    return json({ jobId: id, job: publicJob(job, await readQueue(store())), dailyRemaining: slot.dailyRemaining }, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
