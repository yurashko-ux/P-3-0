// web/app/api/keycrm/statuses/[pipelineId]/route.ts
import { NextResponse } from "next/server";
import { fetchStatuses } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { pipelineId: string } }
) {
  const data = await fetchStatuses(params.pipelineId); // strictly uses provided ENV
  return NextResponse.json({ ok: true, data });
}
