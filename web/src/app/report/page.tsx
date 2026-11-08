import type { Metadata } from "next";
import { Target, Stamp } from "@/components/ui/marks";
import { REPORT } from "@/lib/report";
import "./report.css";

export const metadata: Metadata = {
  title: "Project report",
  description: "Proving Ground project report for the Manycore Aholo Global 3D AI Hackathon.",
  robots: { index: false },
};

const SITE = REPORT.site;

function Slide({ n, title, kicker, children, dark = false }: { n: number; title?: string; kicker?: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <section className={`slide ${dark ? "slide-dark" : ""}`}>
      <header className="slide-head">
        <span className="flex items-center gap-2 font-bold [font-stretch:118%]">
          <Target size={20} /> Proving Ground
        </span>
        {kicker && <span className="slide-kicker">{kicker}</span>}
        <span className="data ml-auto opacity-60">{String(n).padStart(2, "0")} / 10</span>
      </header>
      {title && <h2 className="slide-title placard-sm">{title}</h2>}
      <div className="slide-body">{children}</div>
    </section>
  );
}

function Img({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/report/${src}`} alt={alt} className={`report-img ${className}`} />;
}

export default function ReportPage() {
  return (
    <main className="report">
      {/* 1 cover */}
      <section className="slide slide-dark cover">
        <Img src="hero.png" alt="The robot walking into Lux3D objects in the live arena" className="cover-img" />
        <div className="cover-text">
          <div className="flex items-center gap-3 text-[22px] font-bold [font-stretch:118%]">
            <Target size={34} /> Proving Ground
          </div>
          <h1 className="placard mt-6 text-[64px] leading-[1.02]">Make anything.<br />Watch a real robot deal with it.</h1>
          <p className="mt-6 max-w-[34ch] text-[24px] leading-snug text-white/80">
            Aholo Lux3D turns a photo or a sentence into a physical object. Unitree&apos;s published G1 walking controller has to get past it, live in the browser.
          </p>
          <div className="data mt-10 space-y-1 text-[17px] text-white/70">
            <div>{SITE.replace("https://", "")}</div>
            <div>Manycore Aholo Global 3D AI Hackathon · Rohan Borade (solo) · November 2026</div>
          </div>
        </div>
      </section>

      {/* 2 idea */}
      <Slide n={2} title="Robots fail on the things nobody modelled" kicker="The idea">
        <div className="grid grid-cols-2 gap-14">
          <div className="space-y-6 text-[24px] leading-snug">
            <p>Walking and grasping controllers are tested on a handful of hand-made shapes. Real floors have shoes, toys, cables, chairs and bags.</p>
            <p>Lux3D can build almost any object, at its real size, in about 80 seconds, from a sentence or a photo.</p>
            <p className="font-semibold">So: a robot test range where every obstacle is made by Lux3D, and the robot is a real controller, not an animation.</p>
          </div>
          <div className="space-y-4">
            {REPORT.who.map(([h, t]) => (
              <div key={h} className="report-card">
                <div className="text-[20px] font-semibold">{h}</div>
                <div className="mt-1 text-[18px] leading-snug text-ink-2">{t}</div>
              </div>
            ))}
          </div>
        </div>
      </Slide>

      {/* 3 what it does */}
      <Slide n={3} title="What you can do in one minute" kicker="The product">
        <div className="grid grid-cols-3 gap-6">
          {REPORT.flow.map(([img, h, t]) => (
            <figure key={h}>
              <Img src={img} alt={h} className="aspect-[16/10] w-full object-cover" />
              <figcaption className="mt-3">
                <div className="text-[20px] font-semibold">{h}</div>
                <div className="text-[17px] leading-snug text-ink-2">{t}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </Slide>

      {/* 4 pipeline */}
      <Slide n={4} title="Every object passes through Lux3D" kicker="Use of Manycore tools">
        <div className="grid grid-cols-[1.2fr_1fr] gap-12">
          <table className="report-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Aholo call</th>
                <th>Credits</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {REPORT.calls.map((r) => (
                <tr key={r[0]}>
                  {r.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-5 text-[20px] leading-snug">
            {REPORT.pipelineNotes.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
        </div>
      </Slide>

      {/* 5 iteration: part split */}
      <Slide n={5} title="Iteration 1: one block, or the parts it is made of" kicker="Asset comparison">
        <div className="grid grid-cols-2 gap-10">
          <figure>
            <Img src="compare-whole.png" alt="The generated chair as one convex hull" className="aspect-[4/3] w-full object-cover" />
            <figcaption className="mt-3 text-[19px]">
              <Stamp tone="fault" rotate={-3}>Before</Stamp> <span className="ml-2">Lux3D mesh as one hull: the chair is a solid block. Feet cannot go between the legs.</span>
            </figcaption>
          </figure>
          <figure>
            <Img src="compare-parts.png" alt="The same chair after Lux3D part-split, eight hulls" className="aspect-[4/3] w-full object-cover" />
            <figcaption className="mt-3 text-[19px]">
              <Stamp tone="pass" rotate={-3}>After</Stamp> <span className="ml-2">Lux3D part-split: eight solids (legs, seat, back). Contacts name the part the robot hit.</span>
            </figcaption>
          </figure>
        </div>
      </Slide>

      {/* 6 iteration: size and mass */}
      <Slide n={6} title="Iteration 2: real size, honest mass, light files" kicker="Asset comparison">
        <div className="grid grid-cols-[1.3fr_1fr] gap-10">
          <Img src="materialize-strip.png" alt="Four stages of an object: points, textured mesh, split parts, hulls" className="w-full" />
          <table className="report-table">
            <thead>
              <tr>
                <th>Choice</th>
                <th>First try</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {REPORT.iterations.map((r) => (
                <tr key={r[0]}>
                  {r.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Slide>

      {/* 7 robot */}
      <Slide n={7} title="The robot is real software" kicker="Unitree G1 · MuJoCo in WebAssembly">
        <div className="grid grid-cols-[1fr_1.1fr] gap-12">
          <div className="space-y-5 text-[20px] leading-snug">
            <p>Unitree&apos;s published G1 walking policy (unitree_rl_gym, BSD-3): an LSTM read straight from the TorchScript file and run in plain JavaScript at 50 Hz on 500 Hz MuJoCo physics.</p>
            <p>It is blind: it only feels its joints. Planner mode adds a map of object footprints and an A* path, so the difference between the two pass rates is the value of perception.</p>
          </div>
          <table className="report-table">
            <tbody>
              {REPORT.robot.map((r) => (
                <tr key={r[0]}>
                  <td>{r[0]}</td>
                  <td className="font-semibold">{r[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Slide>

      {/* 8 results */}
      <Slide n={8} title="Ten runs, not one" kicker="Results">
        <div className="grid grid-cols-[1.4fr_1fr] gap-10">
          <Img src="trials.png" alt="Top-down plot of ten trial runs with falls" className="w-full" />
          <div className="space-y-4 text-[19px] leading-snug">
            {REPORT.results.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
        </div>
      </Slide>

      {/* 9 more */}
      <Slide n={9} title="Built for people to play with" kicker="Fun and reach">
        <div className="grid grid-cols-3 gap-6">
          {REPORT.extras.map(([img, h, t]) => (
            <figure key={h}>
              <Img src={img} alt={h} className="aspect-[16/10] w-full object-cover" />
              <figcaption className="mt-3">
                <div className="text-[20px] font-semibold">{h}</div>
                <div className="text-[17px] leading-snug text-ink-2">{t}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </Slide>

      {/* 10 limits */}
      <Slide n={10} title="What it cannot do yet, and what is next" kicker="Honest limits">
        <div className="grid grid-cols-2 gap-12 text-[19px] leading-snug">
          <ul className="list-disc space-y-3 pl-6">
            {REPORT.limits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div>
            <ul className="list-disc space-y-3 pl-6">
              {REPORT.next.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <div className="report-card mt-8 space-y-1 text-[18px]">
              <div>
                Try it: <strong>{SITE.replace("https://", "")}</strong>
              </div>
              <div>Source: {REPORT.repo.replace("https://", "")}</div>
              <div>Video: {REPORT.video}</div>
            </div>
          </div>
        </div>
      </Slide>
    </main>
  );
}
