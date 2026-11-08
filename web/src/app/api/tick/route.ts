import { tick } from "@/lib/pipeline/jobs";
import { errorResponse, json } from "@/lib/pipeline/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

let last: { at: number; result: unknown } | null = null;

async function run() {
  if (last && Date.now() - last.at < 2000) return last.result;
  const result = await tick({ budgetMs: 50_000 });
  last = { at: Date.now(), result };
  return result;
}

/** POST /api/tick → { advanced: string[], queueLength }. The UI calls it while a queue exists. */
export async function POST() {
  try {
    return json(await run());
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/tick: the Vercel cron (every minute). Needs Authorization: Bearer $CRON_SECRET when that is set. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Unauthorised." }, 401);
  try {
    return json(await run());
  } catch (e) {
    return errorResponse(e);
  }
}
