// Phone pairing: a desktop arena shows a room code; a phone that opens /snap/<code> makes an object
// and registers the job here; the desktop polls and drops the object in when Lux3D is done.
import { store, updateJSON, type Store } from "@/lib/storage";
import { getJob } from "@/lib/pipeline/jobs";
import { errorResponse, json } from "@/lib/pipeline/http";
import { clientIp, hashIp, takeSlot } from "@/lib/pipeline/limits";
import { isId } from "@/lib/pipeline/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Room = { code: string; jobs: { id: string; at: number }[]; createdAt: number };
const CODE = /^[A-Z2-9]{5}$/;
const key = (c: string) => `rooms/${c}.json`;
/** Rooms older than this are treated as closed; the arena opens a fresh one on its next poll. */
export const ROOM_TTL_MS = 6 * 3600_000;
const ROOMS_PER_IP_HOUR = 12;
const POSTS_PER_IP_HOUR = 20;
const MAX_JOBS = 12;

const live = (r: Room | undefined, now = Date.now()): r is Room => !!r && typeof r.createdAt === "number" && now - r.createdAt < ROOM_TTL_MS;

async function readRoom(s: Store, code: string): Promise<Room | null> {
  const r = (await s.getJSON<Room>(key(code)))?.value;
  return live(r) ? r : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    if (!CODE.test(code)) return json({ error: "Invalid room code" }, 400);
    const s = store();
    let r = await readRoom(s, code);
    // the desktop arena opens its room on the first poll, so a phone can check the code before spending anything
    if (!r && new URL(req.url).searchParams.get("host") === "1") {
      if (!(await takeSlot("rooms", hashIp(clientIp(req.headers)), ROOMS_PER_IP_HOUR, s)))
        return json({ error: "Too many arenas opened from here this hour. Try again later." }, 429);
      // a missing or expired room starts over with no jobs
      r = await updateJSON<Room>(s, key(code), () => ({ code, jobs: [], createdAt: Date.now() }), (x) => (live(x) ? x : { code, jobs: [], createdAt: Date.now() }));
    }
    return json({ code, exists: !!r, jobs: r?.jobs ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    if (!CODE.test(code)) return json({ error: "Invalid room code" }, 400);
    const s = store();
    if (!(await readRoom(s, code))) return json({ error: "No arena is open with this code" }, 404);
    const body = (await req.json().catch(() => null)) as { jobId?: unknown } | null;
    const jobId = body?.jobId;
    if (!isId(jobId)) return json({ error: "Missing job" }, 400);
    if (!(await takeSlot("room-posts", hashIp(clientIp(req.headers)), POSTS_PER_IP_HOUR, s)))
      return json({ error: "Too many sends from here this hour. Try again later." }, 429);
    // only a real photo or text make (still building or finished) can be sent to an arena; never an export
    const job = (await getJob(jobId, s))?.job;
    if (!job || job.kind === "export" || (job.source !== "photo" && job.source !== "text") || job.status === "failed")
      return json({ error: "No such object job" }, 404);
    if (Date.now() - job.createdAt > ROOM_TTL_MS) return json({ error: "That job is too old to send" }, 400);
    const room = await updateJSON<Room>(
      s,
      key(code),
      () => ({ code, jobs: [], createdAt: Date.now() }),
      (r) => {
        if (!r.jobs.some((j) => j.id === jobId)) r.jobs.push({ id: jobId, at: Date.now() });
        r.jobs = r.jobs.slice(-MAX_JOBS);
        return r;
      },
    );
    return json({ ok: true, jobs: room.jobs.length });
  } catch (e) {
    return errorResponse(e);
  }
}
