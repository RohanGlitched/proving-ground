import type { Metadata } from "next";
import { ArenaApp } from "@/components/arena/ArenaApp";
import { getCourse } from "@/lib/pipeline/courses";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = /^[a-z0-9]{6,16}$/.test(id) ? await getCourse(id).catch(() => null) : null;
  if (!r) return { title: "Shared course" };
  const s = r.stats;
  const rate = s && s.trials > 0 ? `The robot gets through ${Math.round((s.passes / s.trials) * 100)}% of ${s.trials} recorded runs.` : "Nobody has run it yet.";
  const description = `${r.course.objects.length} objects made with Lux3D in front of Unitree's G1 walking policy. ${rate} Try to trip it.`;
  return { title: r.course.title, description, openGraph: { title: `${r.course.title} · Proving Ground`, description }, twitter: { card: "summary_large_image", title: r.course.title, description } };
}

export default async function CoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ challenge?: string }> }) {
  const { id } = await params;
  const { challenge } = await searchParams;
  return <ArenaApp courseId={id} challengeId={challenge} />;
}
