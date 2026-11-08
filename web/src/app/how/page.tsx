import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import { Stamp, Target } from "@/components/ui/marks";
import { HOW } from "@/lib/how";

export const metadata: Metadata = {
  title: "How it works",
  description: "The Lux3D pipeline, the robot controller, the physics and the trials behind Proving Ground, with the numbers we measured.",
};

const TOC = [
  { id: "lux3d", label: "The Lux3D pipeline" },
  { id: "robot", label: "The robot controller" },
  { id: "physics", label: "Objects become physics" },
  { id: "trials", label: "Trials and the planner" },
  { id: "pack", label: "Robot-ready packs" },
  { id: "limits", label: "Limits" },
  { id: "log", label: "Changelog" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-ink/12 py-14">
      <h2 className="placard-sm text-[25px] sm:text-[31px]">{title}</h2>
      <div className="mt-6 space-y-5 text-[16.5px] leading-[1.75] text-ink-2">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="sheet overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[14.5px]">
        <thead>
          <tr className="border-b border-ink/12 text-ink-3">
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-ink/8 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2.5 ${j === 0 ? "font-medium text-ink" : "tnum"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HowPage() {
  return (
    <>
      <Nav />
      <main className="grain mx-auto grid max-w-[1400px] gap-10 px-4 pb-10 pt-12 sm:px-6 md:grid-cols-12 md:pt-20">
        <aside className="md:col-span-3">
          <div className="md:sticky md:top-24">
            <div className="flex items-center gap-2">
              <Target size={20} />
              <span className="font-semibold">How it works</span>
            </div>
            <nav className="mt-4" aria-label="On this page">
              <ol className="space-y-2 text-[15px]">
                {TOC.map((t, i) => (
                  <li key={t.id}>
                    <a className="text-ink-2 hover:text-route" href={`#${t.id}`}>
                      <span className="data mr-2 text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                      {t.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </aside>

        <article className="md:col-span-9 lg:col-span-8">
          <h1 className="placard text-[39px] sm:text-[49px]">How a sentence becomes a test for a robot</h1>
          <p className="mt-5 max-w-[60ch] text-[18px] leading-[1.7] text-ink-2">
            Proving Ground chains Aholo&apos;s Lux3D models into a physics pipeline and puts a real robot controller at the end of it. Everything
            below is what the code does and what we measured. Where a number is an estimate, it says so.
          </p>

          <Section id="lux3d" title="1. The Lux3D pipeline">
            <p>
              Every object is made by Lux3D through Aholo&apos;s API. Inputs go through Aholo&apos;s asset upload first: Lux3D does not read
              third-party URLs. A photo is resized to at most 1024 px and stripped of its metadata before upload.
            </p>
            <Table head={["Step", "Lux3D call", "Credits", "Measured time"]} rows={HOW.lux3dSteps} />
            <p>
              Lux3D runs one generation at a time per account, so jobs wait in a single queue. The job page shows its place in the queue and
              each stage as it finishes. Results expire on Aholo&apos;s side after two hours, so every output is downloaded, processed and
              stored the moment it is ready.
            </p>
            <p>
              Lux3D predicts the object&apos;s real size. The GLB arrives in metres with its bounding box in the metadata, so a generated sneaker
              is 28 cm long and a chair is 85 cm tall without anyone typing a dimension.
            </p>
          </Section>

          <Section id="robot" title="2. The robot controller">
            <p>
              The robot is Unitree&apos;s G1 humanoid with its 12-joint leg model, and the controller is Unitree&apos;s published walking policy
              from <code className="data text-[14px]">unitree_rl_gym</code>: a small LSTM network (47 inputs, 64 hidden, then 32, then 12 joint
              targets). It runs at 50 Hz on top of 500 Hz physics, exactly as Unitree deploys it.
            </p>
            <p>
              We read the published TorchScript file directly and run the network in plain JavaScript, so neither your browser nor our server
              needs PyTorch. Physics is MuJoCo compiled to WebAssembly.
            </p>
            <Table head={["Check", "Result"]} rows={HOW.robotChecks} />
            <p>
              The controller only feels its own body: joint angles, joint speeds, body rotation and gravity. It was trained to walk on flat
              ground with random pushes. It has never seen a chair, a shoe or a laundry basket, which is the point.
            </p>
          </Section>

          <Section id="physics" title="3. Objects become physics">
            <p>
              Each Lux3D part becomes one convex collision shape (MuJoCo wraps every mesh geom in its convex hull). A part-split chair is eight
              solids, so the robot&apos;s foot can go between the legs; a single-mesh chair would be one solid block.
            </p>
            <p>
              Mass is the closed mesh volume times a household density (400 kg/m³ by default, which you can change per object; hull volume would make a chair weigh 18.8 kg instead of 5.2 kg), clamped
              between 50 g and 80 kg. Every object shows its mass and lets you change it. Friction is 0.8 unless set.
            </p>
            <Table head={["Object", "Parts", "Size (cm)", "Mass"]} rows={HOW.objectExamples} />
          </Section>

          <Section id="trials" title="4. Trials and the planner">
            <p>
              A trial walks the robot from its start to the goal flag and records whether it arrives, falls or runs out of time (20 s). Ten
              trials use ten seeds: the start shifts by up to 10 cm and 10°, and optionally each run includes a shove to the pelvis. The same
              seed always gives the same run, so a course&apos;s pass rate is reproducible.
            </p>
            <p>
              <strong className="text-ink">Blind</strong> mode steers straight at the goal: the honest test of the controller.{" "}
              <strong className="text-ink">Planner</strong> mode adds what the controller lacks: a map of every object&apos;s footprint, an A*
              path around them with room for the robot, and a steering loop that follows it. The difference between the two pass rates is how much
              perception would buy.
            </p>
            <Table head={["Course", "Blind", "Planner"]} rows={HOW.trialExamples} />
          </Section>

          <Section id="pack" title="5. Robot-ready packs">
            <p>
              Every library object downloads as a pack: the textured GLB, one STL hull per part in metres, the masses, and an MJCF{" "}
              <code className="data text-[14px]">&lt;body&gt;</code> you can paste into a MuJoCo scene. The same files drive this site&apos;s
              physics, so what you test here is what you get.
            </p>
            <p>
              <Link className="font-semibold text-route underline-offset-4 hover:underline" href="/library">
                Browse the library
              </Link>
            </p>
          </Section>

          <Section id="limits" title="6. Limits">
            <ul className="list-disc space-y-3 pl-5">
              {HOW.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Section>

          <Section id="log" title="7. Changelog">
            <ul className="space-y-3">
              {HOW.changelog.map(([d, t]) => (
                <li key={d + t} className="flex gap-4">
                  <span className="data w-24 shrink-0 text-[13px] text-ink-3">{d}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="pt-4">
              <Stamp tone="route" rotate={-2}>
                Built Nov 9–19, 2026
              </Stamp>
            </div>
          </Section>
        </article>
      </main>
      <Footer />
    </>
  );
}
