// Phone pairing: a desktop arena shows a room code; a phone that opens /snap/<code> makes an object
// and registers the job here; the desktop polls and drops the object in when Lux3D is done.
import { NextResponse } from "next/server";
import { store, updateJSON } from "@/lib/storage";

type Room = { code: string; jobs: { id: string; at: number }[]; createdAt: number };
const CODE = /^[A-Z2-9]{5}$/;
const key = (c: string) => `rooms/${c}.json`;

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!CODE.test(code)) return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  const r = await store().getJSON<Room>(key(code));
  return NextResponse.json({ code, jobs: r?.value.jobs ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!CODE.test(code)) return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { jobId?: string } | null;
  const jobId = body?.jobId;
  if (!jobId || !/^[A-Za-z0-9_-]{6,24}$/.test(jobId)) return NextResponse.json({ error: "Missing job" }, { status: 400 });
  const room = await updateJSON<Room>(
    store(),
    key(code),
    () => ({ code, jobs: [], createdAt: Date.now() }),
    (r) => {
      if (!r.jobs.some((j) => j.id === jobId)) r.jobs.push({ id: jobId, at: Date.now() });
      r.jobs = r.jobs.slice(-12);
      return r;
    },
  );
  return NextResponse.json({ ok: true, jobs: room.jobs.length });
}
