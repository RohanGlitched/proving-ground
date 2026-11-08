import sharp, { type Metadata, type Sharp } from "sharp";
import { STYLES, type Style } from "./aholo";
import type { Kind } from "./jobs";

/** Input checks for POST /api/make. Every failure is a sentence the UI can show as is. */

export const MAX_TEXT = 120;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 1024;

export class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// A minimal blocklist: sexual content, slurs and graphic violence. Matching is on whole words after
// normalising leetspeak, so "Scunthorpe" and "classic" pass.
const BLOCKED = [
  "nude", "nudes", "naked", "porn", "porno", "sex", "sexy", "nsfw", "hentai", "boobs", "boob", "tits", "penis", "vagina", "dick", "cock",
  "pussy", "dildo", "fetish", "erotic", "xxx", "onlyfans", "genitals", "nipple", "nipples", "orgasm", "cum", "milf", "stripper",
  "nazi", "swastika", "kkk", "hitler", "isis", "terrorist", "nigger", "nigga", "faggot", "fag", "retard", "tranny", "chink", "spic", "kike",
  "gore", "corpse", "decapitated", "beheaded", "dismembered", "suicide", "rape", "rapist", "pedo", "pedophile", "loli", "child abuse",
];
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

export function normaliseText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBlocked(text: string): boolean {
  const t = text.toLowerCase().replace(/[013457@$]/g, (c) => LEET[c] ?? c);
  const words = t.split(/[^a-z]+/).filter(Boolean);
  const joined = ` ${words.join(" ")} `;
  return BLOCKED.some((w) => (w.includes(" ") ? joined.includes(` ${w} `) : words.includes(w)));
}

export function checkText(raw: unknown, field = "description", max = MAX_TEXT): string {
  if (typeof raw !== "string") throw new InputError(`Please describe the ${field === "description" ? "object" : field}.`);
  const t = normaliseText(raw);
  if (t.length < 2) throw new InputError("Please describe the object in a few words.");
  if (t.length > max) throw new InputError(`Please keep the ${field} under ${max} characters.`);
  if (isBlocked(t)) throw new InputError("That description isn't allowed here. Try an everyday object.");
  return t;
}

export function checkStyle(raw: unknown): Style {
  if (raw === undefined || raw === null || raw === "") return "photorealistic";
  if (typeof raw === "string" && (STYLES as string[]).includes(raw)) return raw as Style;
  throw new InputError(`Style must be one of: ${STYLES.join(", ")}.`);
}

export function checkKind(raw: unknown): Kind {
  if (raw === undefined || raw === null || raw === "") return "object";
  if (raw === "object" || raw === "pedestrian" || raw === "articulated") return raw;
  throw new InputError("Kind must be object, pedestrian or articulated.");
}

/** Sniffs the real format from magic bytes (the declared type is not trusted). */
export function sniffImage(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Validates a photo and re-encodes it: EXIF orientation applied then all metadata (GPS included) dropped,
 * longest edge ≤ 1024 px, JPEG on a white background (transparent PNGs keep a clean silhouette).
 */
export async function cleanImage(buf: Buffer): Promise<{ jpeg: Buffer; width: number; height: number }> {
  if (buf.length === 0) throw new InputError("The photo is empty.");
  if (buf.length > MAX_IMAGE_BYTES) throw new InputError("The photo is too large; please keep it under 8 MB.", 413);
  if (!sniffImage(buf)) throw new InputError("Please send a JPEG, PNG or WebP photo.", 415);
  let img: Sharp;
  let meta: Metadata;
  try {
    img = sharp(buf, { failOn: "error", limitInputPixels: 50_000_000 });
    meta = await img.metadata();
  } catch {
    throw new InputError("That photo could not be read. Try another one.", 415);
  }
  if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64) throw new InputError("The photo is too small; please use one at least 64 px across.");
  const { data, info } = await img
    .rotate()
    .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

/** The honeypot field must stay empty (bots fill every input). */
export function checkHoneypot(v: unknown): void {
  if (typeof v === "string" && v.trim() !== "") throw new InputError("Request refused.", 400);
}
