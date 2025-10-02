// web/app/api/keycrm/pipelines/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPipelinesMap } from "@/lib/keycrm-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/keycrm/pipelines?force=1 -> форсує оновлення з KeyCRM
export async function GET(req: NextRequest) {
  try {
    const force = req.nextUrl.searchParams.get("force") ? true : false;
    const map = await getPipelinesMap(force);
    const data = Object.entries(map).map(([id, name]) => ({ id, name }));
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("GET /api/keycrm/pipelines failed:", e);
    return NextResponse.json({ ok: false, error: e?.message || "error", data: [] }, { status: 200 });
  }
}
