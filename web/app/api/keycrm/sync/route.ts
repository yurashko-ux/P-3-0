// web/app/api/keycrm/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchPipelines, fetchStatuses } from "@/lib/keycrm";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const K_PIPELINES = "kcrm:pipelines";
const K_STATUSES = (p: string) => `kcrm:st:${p}`;

async function setDict(key: string, map: Record<string,string>) {
  await kv.set(key, { map, updatedAt: Date.now() });
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

// GET/POST /api/keycrm/sync?secret=ADMIN_PASS
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret") || req.headers.get("x-admin-pass") || "";
  if (!process.env.ADMIN_PASS || secret !== process.env.ADMIN_PASS) return unauthorized();

  const pipes = await fetchPipelines(); // safe
  const pMap = Object.fromEntries(pipes.map(p => [String(p.id), String(p.name)]));
  await setDict(K_PIPELINES, pMap);

  let totalSt = 0;
  for (const p of pipes) {
    const sts = await fetchStatuses(String(p.id));
    const sMap = Object.fromEntries(sts.map(s => [String(s.id), String(s.name)]));
    await setDict(K_STATUSES(String(p.id)), sMap);
    totalSt += sts.length;
  }

  return NextResponse.json({ ok: true, pipelines: pipes.length, statuses: totalSt });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
