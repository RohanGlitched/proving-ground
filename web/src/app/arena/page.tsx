import type { Metadata } from "next";
import { ArenaApp } from "@/components/arena/ArenaApp";

export const metadata: Metadata = {
  title: "Arena",
  description: "Build a course from Lux3D objects and watch Unitree's G1 walking controller try to cross it.",
};

export default async function ArenaPage({ searchParams }: { searchParams: Promise<{ make?: string; course?: string; add?: string }> }) {
  const sp = await searchParams;
  return <ArenaApp openMake={sp.make === "1"} courseId={sp.course} addId={sp.add} />;
}
