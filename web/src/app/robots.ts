import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://proving-ground-snowy.vercel.app";
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dev/", "/snap/"] }], sitemap: `${base}/sitemap.xml` };
}
