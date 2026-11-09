// Challenges: gauntlet courses with a goal, a limit and a score. The arena checks them after a set of ten trials
// (fix, trip) or when a steered robot reaches the flag (steer). Bests stay in this browser.

export type Challenge = {
  id: string;
  title: string;
  kind: "fix" | "trip" | "steer";
  /** gauntlet course it starts from (none: an empty floor) */
  courseId?: string;
  brief: string;
  /** fix: most objects you may move, add or remove */
  maxMoves?: number;
  /** trip: most objects you may place */
  maxObjects?: number;
  /** fix: passes needed out of 10; trip: falls needed out of 10 */
  target?: number;
  /** what a good score looks like, shown on the card */
  par?: string;
};

export const CHALLENGES: Challenge[] = [
  {
    id: "fix-moving-day",
    title: "Clear the hallway on moving day",
    kind: "fix",
    courseId: "shs39pqx70",
    brief: "Two boxes and a suitcase: it gets through about 3 runs in 10. Move at most 2 of them so it gets through 9 of 10.",
    maxMoves: 2,
    target: 9,
    par: "2 moves",
  },
  {
    id: "fix-toddlers-room",
    title: "Tidy the toddler's room",
    kind: "fix",
    courseId: "vz6phq9lqn",
    brief: "Toys everywhere, and it gets through about half the runs. Move 1 toy so it gets through 9 of 10.",
    maxMoves: 1,
    target: 9,
    par: "1 move",
  },
  {
    id: "featherweight",
    title: "Featherweight trip",
    kind: "trip",
    brief: "Make the blind robot fall in at least 7 of 10 runs with up to 3 objects. Lower total mass is a better score.",
    maxObjects: 3,
    target: 7,
    par: "under 3 kg",
  },
  {
    id: "steer-gate",
    title: "The gate that won't open",
    kind: "steer",
    courseId: "0kl3x66oz8",
    brief: "The blind robot walks into this gate's hinge side 10 times out of 10. Steer it to the flag yourself, fast.",
    par: "under 15 s",
  },
  {
    id: "steer-building-site",
    title: "Steer the building site",
    kind: "steer",
    courseId: "3g0rya3gl9",
    brief: "Same blocks that trip it blind. Take the keys (WASD or arrows) and walk it to the flag without falling.",
    par: "under 14 s",
  },
];

export const challengeById = (id: string | undefined | null) => CHALLENGES.find((c) => c.id === id) ?? null;

export function challengeHref(c: Challenge) {
  return c.courseId ? `/c/${c.courseId}?challenge=${c.id}` : `/arena?challenge=${c.id}`;
}

/** Best score per challenge, kept in this browser: fix = fewest moves, trip = lightest kg, steer = fastest s. */
export function bestOf(id: string): number | null {
  try {
    const v = localStorage.getItem(`pg-challenge-${id}`);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

/** Records a cleared run; returns true when it beats the stored best. */
export function recordBest(id: string, score: number): boolean {
  const prev = bestOf(id);
  if (prev != null && prev <= score) return false;
  try {
    localStorage.setItem(`pg-challenge-${id}`, String(score));
  } catch {}
  return true;
}

export function scoreLabel(c: Challenge, v: number) {
  if (c.kind === "fix") return `${v} ${v === 1 ? "move" : "moves"}`;
  if (c.kind === "trip") return v < 1 ? `${Math.round(v * 1000)} g` : `${v.toFixed(1)} kg`;
  return `${v.toFixed(1)} s`;
}
