import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { Target } from "@/components/ui/marks";
import { REPORT } from "@/lib/report";
import { readLibrary } from "@/lib/pipeline/library";

export const dynamic = "force-dynamic";
import "./report.css";

export const metadata: Metadata = {
  title: "Project report",
  description: "Proving Ground project report for the Manycore Aholo Global 3D AI Hackathon.",
  robots: { index: false },
};

const SITE = REPORT.site;
const TOTAL = 12;

/** "Nov 9, 2026, 14:35 IST": the library numbers are a snapshot taken when the page is rendered. */
function istStamp(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${f.format(d)} IST`;
}

function Slide({ n, title, kicker, children }: { n: number; title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <div className="slide-frame">
      <section className="slide">
        <header className="slide-head">
          <span className="flex items-center gap-2 font-bold [font-stretch:118%] [font-variation-settings:'wdth'_118]">
            <Target size={20} /> Proving Ground
          </span>
          {kicker && <span className="slide-kicker">{kicker}</span>}
          <span className="data ml-auto opacity-60">
            {String(n).padStart(2, "0")} / {TOTAL}
          </span>
        </header>
        <h2 className="slide-title placard-sm">{title}</h2>
        <div className="slide-body">{children}</div>
      </section>
    </div>
  );
}

function Img({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/report/${src}`} alt={alt} className={`report-img ${className}`} />;
}

/** An image with a label chip pinned to its top-left corner. */
function Tile({ src, alt, chip, tone, bottom = false, imgClass = "", className = "" }: { src: string; alt: string; chip?: string; tone?: "fault" | "pass" | "target"; bottom?: boolean; imgClass?: string; className?: string }) {
  return (
    <div className={`tile ${className}`}>
      <Img src={src} alt={alt} className={imgClass} />
      {chip && <span className={`chip ${tone ?? ""} ${bottom ? "bl" : ""}`}>{chip}</span>}
    </div>
  );
}

/** Triangles from Lux3D for each library object, against the processing budget. */
function TriChart() {
  const rows = REPORT.rawTris;
  const top = [...REPORT.overBudget].sort((a, b) => b[1] - a[1])[0];
  const W = 470;
  const H = 300;
  const m = { l: 44, r: 8, t: 14, b: 26 };
  const max = 35000;
  const bw = (W - m.l - m.r) / rows.length;
  const y = (v: number) => H - m.b - (v / max) * (H - m.t - m.b);
  const limit = REPORT.budget.limit;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Triangles from Lux3D per library object against the 25,000 triangle budget">
      {[0, 10000, 20000, 30000].map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="rgba(20,21,23,0.12)" />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#6b6d70" className="data">
            {t === 0 ? "0" : `${t / 1000}k`}
          </text>
        </g>
      ))}
      {rows.map(([name, v], i) => {
        const over = v > limit;
        return (
          <rect key={name} x={m.l + i * bw + 1.5} y={y(v)} width={bw - 3} height={y(0) - y(v)} fill={over ? "#e0362c" : "#3a3c40"} rx="1">
            <title>{`${name}: ${v.toLocaleString("en-US")} triangles`}</title>
          </rect>
        );
      })}
      <line x1={m.l} x2={W - m.r} y1={y(limit)} y2={y(limit)} stroke="#d9a900" strokeWidth="2" strokeDasharray="6 4" />
      <text x={m.l + 4} y={y(limit) - 6} fontSize="13" fill="#8a6c00" className="data" fontWeight="600">
        budget 25,000
      </text>
      {top && (
        <text x={W - m.r} y={y(top[1]) - 5} textAnchor="end" fontSize="12" fill="#e0362c" className="data" fontWeight="600">
          {top[0].replace("-", " ")} {top[1].toLocaleString("en-US")}
        </text>
      )}
      <text x={m.l} y={H - 6} fontSize="12" fill="#6b6d70" className="data">
        {rows.length} objects, one bar each
      </text>
    </svg>
  );
}

function TimeBars() {
  const max = Math.max(...REPORT.timeline.map((t) => t.total));
  return (
    <div className="space-y-3">
      {REPORT.timeline.map((t) => (
        <div key={t.label} className="cols grid grid-cols-[290px_1fr] items-center gap-5">
          <div className="leading-tight">
            <div className="text-[18px] font-semibold">{t.label}</div>
            <div className="text-[15px] text-ink-3">{t.sub}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="tbar" style={{ width: `${(t.total / max) * 92}%` }}>
              {t.parts.map(([k, s]) => (
                <span key={k} className={`seg-${k}`} style={{ flex: `${s} 1 0` }}>
                  {s} s
                </span>
              ))}
            </div>
            <span className="data text-[17px] font-semibold">{t.total} s</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const SEG_COLOR: Record<string, string> = { generate: "#141517", split: "#2b59e8", rig: "#7d96ef", walk: "#f5c400", ours: "#bfbeb7" };

export default async function ReportPage() {
  const lib = await readLibrary().catch(() => ({ items: [] as { kind: string; parts: number; source: string }[] }));
  const objects = lib.items.filter((i) => i.kind === "object");
  const stats = {
    made: lib.items.length,
    split: objects.filter((i) => i.parts > 1).length,
    parts: objects.reduce((n, i) => n + i.parts, 0),
    people: lib.items.filter((i) => i.kind === "pedestrian").length,
  };
  const snapshot = istStamp();
  const qr = await QRCode.toString(SITE, { type: "svg", margin: 0, color: { dark: "#141517", light: "#00000000" } });

  return (
    <main className="report">
      <nav className="report-nav">
        <Link href="/">← Proving Ground home</Link>
        <span className="no-mobile">Project report · {TOTAL} slides</span>
      </nav>

      {/* 1 cover */}
      <div className="slide-frame">
        <section className="slide slide-dark cover">
          <Img src="hero.png" alt="The robot walking into Lux3D objects in the live arena" className="cover-img" />
          <div className="cover-text">
            <div className="flex items-center gap-3 text-[22px] font-bold [font-stretch:118%] [font-variation-settings:'wdth'_118]">
              <Target size={34} /> Proving Ground
            </div>
            <h1 className="placard mt-6 text-[64px] leading-[1.02]">
              Make anything.
              <br />
              Watch a real robot deal with it.
            </h1>
            <p className="mt-6 max-w-[34ch] text-[24px] leading-snug text-white/80">
              Aholo Lux3D turns a photo or a sentence into a physical object. Unitree&apos;s published G1 walking controller has to get past it, live in the browser.
            </p>
            <div className="data mt-10 space-y-1 text-[17px] text-white/70">
              <div>{SITE.replace("https://", "")}</div>
              <div>Manycore Aholo Global 3D AI Hackathon · Rohan Borade (solo) · November 2026</div>
            </div>
          </div>
        </section>
      </div>

      {/* 2 idea */}
      <Slide n={2} title="Robots fail on the things nobody modelled" kicker="The idea">
        <div className="cols grid grid-cols-[1.05fr_1fr] gap-14">
          <div className="space-y-6 text-[24px] leading-snug">
            <p>Walking and grasping controllers are tested on a handful of hand-made shapes. Real floors have shoes, toys, cables, chairs and bags.</p>
            <p>Lux3D builds almost any object at its real size from a sentence or a photo: about 90 seconds of generation, and about 2 minutes until it stands in front of the robot.</p>
            <p className="font-semibold">So: a robot test range where every obstacle is made by Lux3D, and the robot is a real controller, not an animation.</p>
          </div>
          <div className="space-y-4">
            {REPORT.who.map(([h, t]) => (
              <div key={h} className="report-card">
                <div className="text-[21px] font-semibold">{h}</div>
                <div className="mt-1 text-[18px] leading-snug text-ink-2">{t}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 text-[15px] font-semibold uppercase tracking-[0.08em] text-ink-3">Measured, not estimated</div>
        <div className="cols mt-3 grid grid-cols-4 gap-5">
          {REPORT.numbers.map(([n, h, t]) => (
            <div key={h} className="stat">
              <div className="stat-n">{n}</div>
              <div className="stat-h">{h}</div>
              <div className="stat-t">{t}</div>
            </div>
          ))}
        </div>
      </Slide>

      {/* 3 what it does */}
      <Slide n={3} title="From a sentence to a test result in three steps" kicker="The product">
        <div className="cols grid grid-cols-[364px_1fr_320px] gap-[22px]">
          {REPORT.flow.map(([img, h, t], i) => (
            <figure key={h}>
              <Img src={img} alt={h} className={i === 1 ? "" : "shot"} />
              <figcaption className="mt-3">
                <div className="cap-title">
                  <span className="data mr-2 inline-block rounded-[3px] bg-target px-2 py-[2px] text-[16px]">{i + 1}</span>
                  {h}
                </div>
                <div className="cap-text mt-1">{t}</div>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-4 text-[15px] leading-snug text-ink-3">{REPORT.flowNote}</p>
      </Slide>

      {/* 4 pipeline */}
      <Slide n={4} title="Every object passes through Lux3D" kicker="Use of Manycore tools">
        <div className="cols grid grid-cols-[1.25fr_1fr] gap-10">
          <div className="table-wrap">
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
          </div>
          <div className="space-y-3 text-[17px] leading-snug">
            <div className="report-card grid grid-cols-2 gap-x-6 gap-y-1 !py-3 text-[17px]">
              <div className="col-span-2 text-[14px] font-semibold text-ink-3">Library snapshot, {snapshot}, all made by Lux3D</div>
              <div>
                <span className="data text-[28px]">{stats.made}</span> objects and people
              </div>
              <div>
                <span className="data text-[28px]">{stats.parts}</span> collision parts
              </div>
              <div>
                <span className="data text-[28px]">{stats.split}</span> split by part-split
              </div>
              <div>
                <span className="data text-[28px]">{stats.people}</span> rigged {stats.people === 1 ? "walker" : "walkers"}
              </div>
            </div>
            {REPORT.pipelineNotes.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
        </div>
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-[20px] font-semibold">Where the time goes</span>
            <span className="text-[15px] text-ink-3">seconds from the stored records of three finished jobs</span>
          </div>
          <TimeBars />
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[15px] text-ink-2">
            {Object.entries(REPORT.timelineKey).map(([k, v]) => (
              <span key={k}>
                <span className="key-dot" style={{ background: SEG_COLOR[k] }} />
                {v}
              </span>
            ))}
          </div>
        </div>
      </Slide>

      {/* 5 iteration: Turbo against G1 */}
      <Slide n={5} title="Iteration 1: Lux3D Turbo against G1" kicker="Asset comparison">
        <div className="cols grid grid-cols-2 gap-6">
          <div>
            <div className="mb-2 text-[17px] text-ink-2">
              <strong>Traffic cone</strong> · “an orange traffic cone with a white reflective band”
            </div>
            <div className="cols-2 grid grid-cols-2 gap-4">
              <Tile src="g1-cone-turbo.jpg" alt="Traffic cone generated with G1-Turbo" chip="G1-Turbo · 84 s · 13 credits" />
              <Tile src="g1-cone-g1.jpg" alt="Traffic cone generated with G1" chip="G1 · 285 s · 20 credits" tone="target" />
            </div>
          </div>
          <div>
            <div className="mb-2 text-[17px] text-ink-2">
              <strong>Park bench</strong> · “a wooden park bench with cast iron legs” · blue = part hulls
            </div>
            <div className="cols-2 grid grid-cols-2 gap-4">
              <Tile src="g1-bench-turbo.jpg" alt="Park bench generated with G1-Turbo, five parts" chip="G1-Turbo · 5 parts" />
              <Tile src="g1-bench-g1.jpg" alt="Park bench generated with G1, four parts" chip="G1 · 4 parts" tone="target" />
            </div>
          </div>
        </div>
        <div className="table-wrap mt-5">
          <table className="report-table compact">
            <thead>
              <tr>
                <th className="w-[24%]"> </th>
                {REPORT.g1.cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REPORT.g1.rows.map((r) => (
                <tr key={r[0]}>
                  <td className="font-semibold">{r[0]}</td>
                  {r.slice(1).map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[18px] leading-snug text-ink-2">{REPORT.g1.verdict}</p>
      </Slide>

      {/* 6 iteration: one hull or the parts */}
      <Slide n={6} title="Iteration 2: one hull, or one per part" kicker="Asset comparison">
        <div className="cols grid grid-cols-[440px_440px_1fr] gap-6">
          <figure>
            <Tile src="hull-whole.jpg" alt="The generated chair wrapped in one convex hull" chip="Before · one hull" tone="fault" />
            <figcaption className="cap-text mt-2">The chair is a solid, slanted block: the gaps between the legs do not exist.</figcaption>
          </figure>
          <figure>
            <Tile src="hull-parts.jpg" alt="The same chair after part-split, eight hulls" chip="After · eight hulls" tone="pass" />
            <figcaption className="cap-text mt-2">Lux3D part-split: legs, rungs, seat and back are separate solids with their own mass.</figcaption>
          </figure>
          <div>
            <table className="report-table compact">
              <thead>
                <tr>
                  <th> </th>
                  <th>First try</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                {REPORT.hulls.map((r) => (
                  <tr key={r[0]}>
                    <td className="font-semibold">{r[0]}</td>
                    <td>{r[1]}</td>
                    <td>{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[16px] leading-snug text-ink-2">{REPORT.hullsNote}</p>
          </div>
        </div>
        <div className="mt-4 text-[15px] font-semibold uppercase tracking-[0.08em] text-ink-3">How every object arrives in the arena</div>
        <div className="cols-2 mt-2 grid grid-cols-4 gap-4">
          {REPORT.materialize.map(([img, h, t], i) => (
            <figure key={h}>
              <div className="tile">
                <Img src={img} alt={h} className="aspect-[16/9] object-cover" />
                <span className="chip">{i + 1}</span>
              </div>
              <figcaption className="mt-2 text-[17px] leading-tight">
                <strong>{h}</strong> <span className="text-ink-3">· {t}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Slide>

      {/* 7 iteration: raw mesh to browser asset */}
      <Slide n={7} title="Iteration 3: 305,236 triangles down to 24,250" kicker="Asset comparison">
        <div className="cols grid grid-cols-[960px_1fr] gap-8">
          <div>
            <div className="cols-2 grid grid-cols-2 gap-4">
              <figure>
                <Tile src="sneaker-raw.jpg" alt="The raw Lux3D sneaker mesh with its wireframe, too dense to see" chip="Lux3D mesh · 305,236 triangles" tone="fault" />
              </figure>
              <figure>
                <Tile src="sneaker-final.jpg" alt="The processed sneaker with its wireframe" chip="After processing · 24,250" tone="pass" />
              </figure>
            </div>
            <div className="table-wrap mt-4">
              <table className="report-table compact">
                <thead>
                  <tr>
                    <th className="w-[26%]"> </th>
                    <th>First try (sneaker from a photo)</th>
                    <th>Now</th>
                  </tr>
                </thead>
                <tbody>
                  {REPORT.budget.rows.map((r) => (
                    <tr key={r[0]}>
                      <td className="font-semibold">{r[0]}</td>
                      <td>{r[1]}</td>
                      <td>{r[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="report-card !p-4">
            <div className="text-[18px] font-semibold leading-snug">Triangles Lux3D returned, against the budget the browser gets</div>
            <div className="mt-2">
              <TriChart />
            </div>
            <p className="mt-2 text-[15px] leading-snug text-ink-2">
              We ask Lux3D for 20,000 faces up front, so almost everything arrives under the 25,000 budget. The red bars did not and were simplified to just under it.
            </p>
            <p className="mt-4 border-t border-ink/10 pt-3 text-[17px] font-semibold leading-snug">{REPORT.budget.totals}</p>
          </div>
        </div>
      </Slide>

      {/* 8 iteration: a bad generation */}
      <Slide n={8} title="Iteration 4: a 3.86 m door, and the size check" kicker="Asset comparison">
        <div className="cols-2 grid grid-cols-[262px_262px_450px_450px] justify-between gap-x-3">
          <Tile src="door-raw.jpg" imgClass="!h-[280px] object-cover" alt="The door Lux3D returned, 3.86 m tall, next to a 1.8 m person" chip="Lux3D returned" tone="fault" bottom />
          <Tile src="door-fixed.jpg" imgClass="!h-[280px] object-cover" alt="The same door after the size check, 2.05 m" chip="After the size check" tone="pass" bottom />
          <Tile src="skate-raw.jpg" imgClass="!h-[280px] object-cover" alt="The skateboard Lux3D returned, 2.20 m long" chip="Lux3D returned" tone="fault" bottom />
          <Tile src="skate-fixed.jpg" imgClass="!h-[280px] object-cover" alt="The same skateboard after the size check, 0.80 m" chip="After the size check" tone="pass" bottom />
        </div>
        <p className="mt-2 text-[15px] text-ink-3">Same meshes, same camera. The person beside each object is the Lux3D-made jogger, 1.8 m; yellow ruler in metres; green marks the typical size.</p>
        <div className="cols mt-4 grid grid-cols-[1.15fr_1fr] gap-8">
          <div className="report-card space-y-3 self-start !py-4">
            <div className="text-[20px] font-semibold">How it was handled</div>
            {REPORT.badGen.steps.map(([h, t], i) => (
              <div key={h} className="flex gap-3 text-[17px] leading-snug">
                <span className="data mt-[2px] inline-block h-[26px] w-[26px] shrink-0 rounded-[3px] bg-target text-center text-[15px] leading-[26px]">{i + 1}</span>
                <div>
                  <strong>{h}:</strong> {t}
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-2 text-[17px] font-semibold">Library objects outside the 35% band (largest dimension{REPORT.badGen.outside > 5 ? `; ${REPORT.badGen.rows.length} of ${REPORT.badGen.outside} shown` : ""})</div>
            <table className="report-table compact">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Lux3D returned</th>
                  <th>Typical</th>
                  <th>Scale</th>
                </tr>
              </thead>
              <tbody>
                {REPORT.badGen.rows.map((r) => (
                  <tr key={r[0]}>
                    <td className="font-semibold">{r[0]}</td>
                    <td>{r[1]}</td>
                    <td>{r[2]}</td>
                    <td>{r[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[17px] leading-snug text-ink-2">{REPORT.badGen.note}</p>
          </div>
        </div>
      </Slide>

      {/* 9 robot */}
      <Slide n={9} title="The robot is real software" kicker="Unitree G1 · MuJoCo in WebAssembly">
        <div className="cols grid grid-cols-[600px_1fr] gap-8">
          <div>
            <div className="space-y-3 text-[19px] leading-snug">
              <p>
                The walking policy is the G1 policy Unitree published in <span className="data text-[17px]">unitree_rl_gym</span> (BSD-3), the one their sim-to-real example deploys on the physical robot. We did not retrain or change it.
              </p>
              <p>It is blind: it only feels its joints. Planner mode adds a map of object footprints and an A* path, and waits when a walking person is about to cross. The difference between the two pass rates is the value of perception.</p>
            </div>
            <table className="report-table compact mt-4">
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
          <figure>
            <Img src="robot-plan.jpg" alt="Planner mode with collision hulls on: the robot waits at the start while the jogger crosses" />
            <figcaption className="mt-2 text-[16px] leading-snug text-ink-2">{REPORT.robotNote}</figcaption>
          </figure>
        </div>
        <div className="loop mt-5">
          {REPORT.loop.map(([h, t]) => (
            <div key={h}>
              <div className="text-[18px] font-semibold">{h}</div>
              <div className="text-[15px] leading-snug text-ink-3">{t}</div>
            </div>
          ))}
        </div>
      </Slide>

      {/* 10 results */}
      <Slide n={10} title="Ten runs, not one" kicker="Results">
        <div className="cols grid grid-cols-[800px_1fr] gap-9">
          <div className="space-y-3">
            <Tile src="res-blind.jpg" alt={`Blind walk on the starter course with the jogger: ${REPORT.jog.blind * 10}% reached the goal`} chip="Blind walk" />
            <Tile src="res-planner.jpg" alt={`Planner on the same course: ${REPORT.jog.planner * 10}% reached the goal`} chip="Planner" tone="pass" />
          </div>
          <div>
            <div className="mb-2 flex items-baseline gap-3">
              <span className="text-[19px] font-semibold">Pass rate by course</span>
              <span className="text-[15px] text-ink-3">ten seeded runs each; – = not run</span>
            </div>
            <table className="report-table compact">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Blind walk</th>
                  <th>Planner</th>
                </tr>
              </thead>
              <tbody>
                {REPORT.resultTable.map((r) => (
                  <tr key={r[0]}>
                    <td>{r[0]}</td>
                    <td className="font-semibold">{r[1]}</td>
                    <td className="font-semibold">{r[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 space-y-3 text-[17px] leading-snug">
              {REPORT.results.map((t) => (
                <p key={t}>{t}</p>
              ))}
            </div>
          </div>
        </div>
      </Slide>

      {/* 11 more */}
      <Slide n={11} title="Built for people to play with" kicker="Fun and reach">
        <div className="cols grid grid-cols-[316px_1fr_1fr] gap-[22px]">
          {REPORT.extras.map(([img, h, t]) => (
            <figure key={h}>
              <Img src={img} alt={h} className="shot-fade" />
              <figcaption className="mt-3">
                <div className="cap-title">{h}</div>
                <div className="cap-text mt-1">{t}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </Slide>

      {/* 12 limits */}
      <Slide n={12} title="What it cannot do yet, and what is next" kicker="Honest limits">
        <div className="cols grid grid-cols-[1.2fr_1fr_330px] gap-9">
          <div>
            <div className="mb-2 text-[15px] font-semibold uppercase tracking-[0.08em] text-ink-3">Limits</div>
            <ul className="list-disc space-y-3 pl-6 text-[21px] leading-snug">
              {REPORT.limits.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-[15px] font-semibold uppercase tracking-[0.08em] text-ink-3">Next</div>
            <ul className="list-disc space-y-3 pl-6 text-[21px] leading-snug">
              {REPORT.next.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="report-card space-y-2 text-[17px]">
            <div className="mx-auto h-[190px] w-[190px]" dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code for the live site" role="img" />
            <div className="text-center text-[15px] text-ink-3">Scan to open the arena</div>
            <div>
              Try it: <strong>{SITE.replace("https://", "")}</strong>
            </div>
            <div>Source: {REPORT.repo.replace("https://", "")}</div>
            <div>Video: {REPORT.video}</div>
          </div>
        </div>
        <div className="mt-9 text-[15px] font-semibold uppercase tracking-[0.08em] text-ink-3">Built on</div>
        <div className="cols-2 mt-2 grid grid-cols-4 gap-4">
          {REPORT.credits.map(([h, t]) => (
            <div key={h} className="report-card !py-4">
              <div className="text-[20px] font-semibold">{h}</div>
              <div className="mt-1 text-[16px] leading-snug text-ink-3">{t}</div>
            </div>
          ))}
        </div>
      </Slide>
    </main>
  );
}
