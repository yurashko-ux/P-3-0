// web/app/api/keycrm/pipelines/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPipelinesMap } from "@/lib/keycrm-cache";
import { diagPipelines, fetchPipelines } from "@/lib/keycrm";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const K_PIPELINES = "kcrm:pipelines";

export async function GET(req: NextRequest) {
  try {
    const force = !!req.nextUrl.searchParams.get("force");
    // 1) KV-кеш
    if (!force) {
      const entry = await kv.get<{ map: Record<string,string>; updatedAt: number } | null>(K_PIPELINES);
      if (entry?.map && Object.keys(entry.map).length) {
        const data = Object.entries(entry.map).map(([id, name]) => ({ id, name }));
        return NextResponse.json({ ok: true, data, cache: true });
      }
    }
    // 2) live запит у KeyCRM
    const list = await fetchPipelines();
    if (list.length) {
      const map = Object.fromEntries(list.map(x => [x.id, x.name]));
      await kv.set(K_PIPELINES, { map, updatedAt: Date.now() });
      return NextResponse.json({ ok: true, data: list, cache: false });
    }
    // 3) діагностика якщо порожньо
    const diag = await diagPipelines();
    return NextResponse.json({ ok: true, data: [], cache: false, errors: diag.trace });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error", data: [] }, { status: 200 });
  }
}
