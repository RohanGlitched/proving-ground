import { store } from "@/lib/storage";
import { config } from "@/lib/pipeline/config";
import { getJob, readQueue } from "@/lib/pipeline/jobs";
import { cachedCredits, errorResponse, json } from "@/lib/pipeline/http";
import { dailyRemaining } from "@/lib/pipeline/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/status → { queueLength, activeJob, credits, dailyRemaining, paused, accepting } */
export async function GET() {
  try {
    const s = store();
    const [q, credits, remaining] = await Promise.all([readQueue(s), cachedCredits(), dailyRemaining(s)]);
    const active = q.items.find((i) => i.state === "active");
    let activeJob = null;
    if (active) {
      const j = (await getJob(active.jobId, s))?.job;
      if (j) {
        const st = j.stages.find((x) => x.status === "running" || x.status === "pending");
        activeJob = { id: j.id, kind: j.kind, stage: st?.name ?? null, startedAt: j.startedAt ?? null };
      }
    }
    const lowCredits = credits !== null && credits < config.minCredits;
    return json(
      { queueLength: q.items.length, activeJob, credits, dailyRemaining: remaining, paused: config.paused, accepting: !config.paused && !lowCredits && remaining > 0 },
      200,
      { "cache-control": "public, max-age=5, s-maxage=5" },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
