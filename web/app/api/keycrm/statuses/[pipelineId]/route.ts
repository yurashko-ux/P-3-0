// web/app/api/keycrm/statuses/[pipelineId]/route.ts
import { NextResponse } from "next/server";
import { fetchStatuses } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { pipelineId: string } }
) {
  try {
    const data = await fetchStatuses(params.pipelineId); // safe: [] при збої
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("GET /api/keycrm/statuses failed:", e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
