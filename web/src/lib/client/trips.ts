// Trip test: an object alone 1.4 m ahead of the robot, ten seeded blind walks.
// Library objects are pre-tested (public/trip-index.json, scripts/sim-trips.mjs); anything else can be
// tested live in the browser with the same settings.
import { getPhysics } from "./api";
import { defaultDensity } from "@/lib/density";

export type TripResult = { n: number; passes: number; falls: number; timeouts: number; touched: number; live?: boolean; /** kg at the default density, as simulated */ mass?: number };

export const massLabel = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg < 10 ? kg.toFixed(1) : Math.round(kg)} kg`);

let index: Promise<Record<string, TripResult>> | null = null;
export function tripIndex() {
  if (!index) {
    index = fetch("/trip-index.json")
      .then((r) => (r.ok ? r.json() : { items: {} }))
      .then((d) => (d.items ?? {}) as Record<string, TripResult>)
      .catch(() => ({}));
  }
  return index;
}

export function verdict(t: TripResult): { label: string; tone: "pass" | "fault" | "ink" } {
  if (t.passes === t.n) return { label: `Cleared ${t.passes}/${t.n}`, tone: "pass" };
  if (t.falls >= t.n / 2) return { label: `Tripped ${t.falls}/${t.n}`, tone: "fault" };
  if (t.passes === 0 && t.timeouts >= t.n / 2) return { label: `Blocked ${t.timeouts}/${t.n}`, tone: "fault" };
  return { label: `${t.passes}/${t.n} got past`, tone: "ink" };
}

/** Run the same trip test live (trials worker). */
export async function runTripTest(objectId: string, name: string, slug?: string): Promise<TripResult> {
  const { createSim } = await import("@/sim/client");
  const sim = createSim();
  try {
    const ph = await getPhysics(objectId);
    const s = await sim.runTrials({
      scene: { objects: [{ id: objectId, name, parts: ph.parts, x: 1.4, y: 0, yaw: ph.joints ? -1.5708 : 0.3, mass: ph.volume ? ph.volume * defaultDensity({ slug }) : undefined, ...(ph.joints ? { joints: ph.joints } : {}) }], goal: { x: 3.6, y: 0 }, start: { x: 0, y: 0, yaw: 0 } },
      n: 10,
      seed: 11,
      mode: "blind",
      jitter: { startPos: 0.1, startYaw: 0.17, objectPos: 0.1, objectYaw: 0.6 },
      maxSeconds: 14,
    });
    return {
      n: 10,
      passes: s.trials.filter((t) => t.result === "goal").length,
      falls: s.trials.filter((t) => t.result === "fell").length,
      timeouts: s.trials.filter((t) => t.result === "timeout").length,
      touched: s.trials.filter((t) => t.contacts.length > 0).length,
      live: true,
    };
  } finally {
    sim.dispose();
  }
}
