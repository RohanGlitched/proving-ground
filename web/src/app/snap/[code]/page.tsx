import type { Metadata } from "next";
import { SnapApp } from "@/components/snap/SnapApp";

export const metadata: Metadata = { title: "Snap an object", robots: { index: false } };

export default async function SnapPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <SnapApp code={code.toUpperCase()} />;
}
