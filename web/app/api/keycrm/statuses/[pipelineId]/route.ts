// web/app/api/keycrm/statuses/[pipelineId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStatusesMap } from "@/lib/keycrm-cache";
import { diagStatuses, fetchStatuses } from "@/lib/keycrm";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const K_STATUSES = (p: string) => `kcrm:st:${p}`;

export async function GET(req: NextRequest, { params }: { params: { pipelineId: string } }) {
  try {
    const pid = params.pipelineId;
    const force = !!req.nextUrl.searchParams.get("force");

    if (!force) {
      const entry = await kv.get<{ map: Record<string,string>; updatedAt: number } | null>(K_STATUSES(pid));
      if (entry?.map && Object.keys(entry.map).length) {
        const data = Object.entries(entry.map).map(([id, name]) => ({ id, name }));
        return NextResponse.json({ ok: true, data, cache: true });
      }
    }

    const list = await fetchStatuses(pid);
    if (list.length) {
      const map = Object.fromEntries(list.map(x => [x.id, x.name]));
      await kv.set(K_STATUSES(pid), { map, updatedAt: Date.now() });
      return NextResponse.json({ ok: true, data: list, cache: false });
    }

    const diag = await diagStatuses(pid);
    return NextResponse.json({ ok: true, data: [], cache: false, errors: diag.trace });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error", data: [] }, { status: 200 });
  }
}
