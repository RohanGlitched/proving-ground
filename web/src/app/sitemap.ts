import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://proving-ground-snowy.vercel.app";
  return ["", "/arena", "/library", "/gauntlet", "/how", "/report"].map((p) => ({ url: `${base}${p}`, changeFrequency: "daily" as const }));
}
