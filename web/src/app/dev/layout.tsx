import { notFound } from "next/navigation";

// Dev-only pages (sim test bench, report captures) never ship to production.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  return children;
}
