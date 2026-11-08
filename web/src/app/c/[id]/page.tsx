import type { Metadata } from "next";
import { ArenaApp } from "@/components/arena/ArenaApp";

export const metadata: Metadata = { title: "Shared course" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ArenaApp courseId={id} />;
}
