import Link from "next/link";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { Stamp, Target, Ruler } from "@/components/ui/marks";
import { HeroArena } from "@/components/home/HeroArena";
import { PipelineScroll } from "@/components/home/PipelineScroll";
import { TrialWall } from "@/components/home/TrialWall";
import { LibraryShelf } from "@/components/home/LibraryShelf";
import { GauntletPreview } from "@/components/home/GauntletPreview";
import { FACTS } from "@/lib/facts";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="grain">
        {/* HERO: a live camera on the arena */}
        <section className="relative">
          <HeroArena />
        </section>

        {/* What this is, in one breath */}
        <section className="mx-auto grid max-w-[1400px] gap-10 px-4 pt-16 sm:px-6 md:grid-cols-12 md:pt-24">
          <div className="md:col-span-7">
            <h2 className="placard text-[31px] sm:text-[39px] md:text-[49px]">
              Every object here was made by Lux3D. The robot has never seen any of them.
            </h2>
          </div>
          <div className="space-y-5 text-[17px] leading-[1.7] text-ink-2 md:col-span-5 md:pt-2">
            <p>
              Type <em>a laundry basket</em> or photograph the shoe by your door. Aholo Lux3D builds it as a textured 3D model at its real size,
              splits it into the pieces it is made of, and each piece becomes a solid with mass. Then it lands in front of a Unitree G1.
            </p>
            <p>
              The robot runs Unitree&apos;s published walking controller: the same neural network that drives the real G1, here running in your
              browser on MuJoCo physics. It was never trained on your shoe. You find out what happens.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/arena?make=1" className="inline-flex h-11 items-center rounded-[10px] bg-target px-5 font-semibold shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]">
                Make something
              </Link>
              <Link href="/arena" className="inline-flex h-11 items-center rounded-[10px] border border-ink/20 px-5 font-semibold hover:bg-ink/5">
                Open the arena
              </Link>
            </div>
          </div>
        </section>

        {/* THE PIPELINE, scroll-driven */}
        <section id="pipeline" className="mt-24">
          <PipelineScroll />
        </section>

        {/* TEN RUNS */}
        <section id="trials" className="mx-auto mt-28 max-w-[1400px] px-4 sm:px-6">
          <div className="grid gap-8 md:grid-cols-12">
            <div className="md:col-span-5">
              <h2 className="placard-sm text-[31px] sm:text-[39px]">One walk is an anecdote. Ten is a test.</h2>
              <p className="mt-5 text-[17px] leading-[1.7] text-ink-2">
                Every course runs ten times with a different seed: the robot starts a little off-line, objects shift by a few centimetres, and
                sometimes something shoves the robot mid-stride. You get a pass rate, where it fell, and what it tripped on.
              </p>
            </div>
            <div className="md:col-span-7">
              <TrialWall />
            </div>
          </div>
        </section>

        {/* LIBRARY */}
        <section id="library" className="mt-28">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
            <div className="flex flex-wrap items-end gap-6">
              <h2 className="placard-sm text-[31px] sm:text-[39px]">The library: everything anyone has made</h2>
              <Link href="/library" className="ml-auto text-[15px] font-semibold text-route underline-offset-4 hover:underline">
                See all objects
              </Link>
            </div>
            <p className="mt-4 max-w-2xl text-[17px] leading-[1.7] text-ink-2">
              Each object keeps its real-world size from Lux3D, its parts, their hulls and a mass. Drag any of them into the arena, or download it
              as a robot-ready pack for your own simulator.
            </p>
          </div>
          <LibraryShelf />
        </section>

        {/* GAUNTLET */}
        <section id="gauntlet" className="mx-auto mt-28 max-w-[1400px] px-4 sm:px-6">
          <div className="flex flex-wrap items-end gap-6">
            <h2 className="placard-sm text-[31px] sm:text-[39px]">The gauntlet</h2>
            <Link href="/gauntlet" className="ml-auto text-[15px] font-semibold text-route underline-offset-4 hover:underline">
              All courses
            </Link>
          </div>
          <p className="mt-4 max-w-2xl text-[17px] leading-[1.7] text-ink-2">
            Courses people built from their own things, ranked by how often the robot fails them. Remix one, beat it with the planner, or make it
            meaner.
          </p>
          <GauntletPreview />
        </section>

        {/* MEASURED */}
        <section id="measured" className="mx-auto mt-28 max-w-[1400px] px-4 sm:px-6">
          <h2 className="placard-sm text-[31px] sm:text-[39px]">Measured, not claimed</h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-[3px] bg-ink/15 sm:grid-cols-2 lg:grid-cols-5">
            {FACTS.map((f) => (
              <div key={f.label} className="bg-paper p-6">
                <div className="data text-[25px] text-ink sm:text-[31px]">{f.value}</div>
                <div className="mt-2 text-[15px] font-semibold">{f.label}</div>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-3">{f.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FOR ROBOTICS TEAMS */}
        <section id="teams" className="mx-auto mt-28 max-w-[1400px] px-4 sm:px-6">
          <div className="sheet grid gap-8 p-6 sm:p-10 md:grid-cols-12">
            <div className="md:col-span-6">
              <div className="flex items-center gap-3">
                <Target size={28} />
                <Stamp tone="route" rotate={-3}>
                  For robotics teams
                </Stamp>
              </div>
              <h2 className="placard-sm mt-6 text-[25px] sm:text-[31px]">Test objects in 90 seconds instead of an afternoon in Blender.</h2>
              <p className="mt-4 text-[16px] leading-[1.7] text-ink-2">
                Walking and grasping policies fail on the things nobody modelled. Every object here downloads as a pack your simulator can load
                directly: the textured mesh, one convex hull per part, the masses, and an MJCF snippet you can include in a MuJoCo scene.
              </p>
            </div>
            <div className="md:col-span-6">
              <pre className="data overflow-x-auto rounded-[3px] bg-ink p-5 text-[12.5px] leading-[1.7] text-white/85">{`chair-4f2a/
  visual.glb          textured, metric, Y-up
  parts/part-0.stl    convex hull, metres
  parts/part-1.stl    …8 parts from Lux3D part-split
  object.xml          <body> with 8 mesh geoms,
                      mass 5.4 kg, friction 0.8
  meta.json           size, source prompt, task ids`}</pre>
              <Ruler metres={3} className="mt-6" />
            </div>
          </div>
        </section>

        {/* LIMITS */}
        <section id="limits" className="mx-auto mt-28 max-w-[1400px] px-4 sm:px-6">
          <h2 className="placard-sm text-[31px] sm:text-[39px]">What it can&apos;t do yet</h2>
          <ul className="mt-6 grid gap-x-10 gap-y-4 text-[16px] leading-[1.7] text-ink-2 md:grid-cols-2">
            <li>
              <strong className="text-ink">The robot is blind.</strong> Unitree&apos;s published controller only feels its own joints. The planner
              mode adds a map of the objects so it can walk around them; the controller itself never sees them.
            </li>
            <li>
              <strong className="text-ink">Hulls, not exact shapes.</strong> Each part collides as its convex hull. A mug&apos;s inside is solid. More
              parts from part-split means a closer fit.
            </li>
            <li>
              <strong className="text-ink">Masses are estimates.</strong> Lux3D predicts size, not weight. Mass is the mesh volume times a density for
              the kind of object, shown on every object so you can change it.
            </li>
            <li>
              <strong className="text-ink">One generation at a time.</strong> Lux3D runs one task per account, so new objects queue. The library is
              there while you wait.
            </li>
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}
