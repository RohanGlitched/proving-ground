import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { CourseList } from "@/components/gauntlet/CourseList";

export const metadata: Metadata = {
  title: "Gauntlet",
  description: "Courses people built from Lux3D objects, ranked by how often Unitree's G1 walking controller fails them.",
};

export default function GauntletPage() {
  return (
    <>
      <Nav />
      <main className="grain mx-auto max-w-[1400px] px-4 pb-10 pt-12 sm:px-6 md:pt-16">
        <div className="grid gap-6 md:grid-cols-12">
          <div className="md:col-span-7">
            <h1 className="placard text-[39px] sm:text-[49px]">The gauntlet</h1>
            <p className="mt-4 max-w-2xl text-[17px] leading-[1.7] text-ink-2">
              Courses built from Lux3D objects and tested ten runs at a time. The pass rate is the share of all recorded trials where the robot
              reached the flag. Open one to watch it, remix it, or try to beat it with the planner.
            </p>
          </div>
          <div className="flex items-end md:col-span-5 md:justify-end">
            <Link href="/arena" className="inline-flex h-11 items-center rounded-[10px] bg-target px-5 font-semibold shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]">
              Build a course
            </Link>
          </div>
        </div>
        <CourseList />
      </main>
      <Footer />
    </>
  );
}
