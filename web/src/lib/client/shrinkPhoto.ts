// Phone photos are often 3–12 MB, over the 4.5 MB a Vercel function will accept, and the server only
// keeps 1024 px anyway. So the browser decodes the photo (upright, per its EXIF orientation), scales the
// longest edge to 1024 px and re-encodes it as a JPEG of a few hundred KB before it is sent.

export const PHOTO_EDGE = 1024;
const QUALITY = 0.88;

export class PhotoError extends Error {}

const UNREADABLE =
  "This browser can't read that photo (HEIC photos from iPhones often do this). Please choose a JPG or PNG, or set the camera to Most Compatible.";

type Drawable = { source: CanvasImageSource; width: number; height: number; close?: () => void };

async function decode(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: b, width: b.width, height: b.height, close: () => b.close() };
    } catch {
      // older engines reject the options bag; try once without it before falling back to <img>
      try {
        const b = await createImageBitmap(file);
        return { source: b, width: b.width, height: b.height, close: () => b.close() };
      } catch {
        /* fall through to <img>, which some browsers can decode when createImageBitmap can't */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode(); // <img> applies EXIF orientation by default (image-orientation: from-image)
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty image");
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    throw new PhotoError(UNREADABLE);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Returns the photo as an upright JPEG whose longest edge is at most 1024 px. */
export async function shrinkPhoto(file: Blob, maxEdge = PHOTO_EDGE): Promise<Blob> {
  const img = await decode(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("Your browser could not prepare the photo. Please try another browser.");
    ctx.fillStyle = "#ffffff"; // transparent PNGs would otherwise turn black in a JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!out || !out.size) throw new PhotoError("Your browser could not prepare the photo. Please try a JPG or PNG.");
    return out;
  } finally {
    img.close?.();
  }
}
