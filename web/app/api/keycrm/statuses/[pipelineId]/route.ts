// web/app/api/keycrm/statuses/[pipelineId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStatusesMap } from "@/lib/keycrm-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/keycrm/statuses/:pipelineId?force=1
export async function GET(
  req: NextRequest,
  { params }: { params: { pipelineId: string } }
) {
  try {
    const force = req.nextUrl.searchParams.get("force") ? true : false;
    const map = await getStatusesMap(params.pipelineId, force);
    const data = Object.entries(map).map(([id, name]) => ({ id, name }));
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("GET /api/keycrm/statuses failed:", e);
    return NextResponse.json({ ok: false, error: e?.message || "error", data: [] }, { status: 200 });
  }
}
