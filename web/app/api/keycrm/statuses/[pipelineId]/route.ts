// web/app/api/keycrm/statuses/[pipelineId]/route.ts
import { NextResponse } from "next/server";

import { fetchKeycrmPipelineDetail } from "@/lib/keycrm-pipelines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { pipelineId: string } }
) {
  const pipelineId = Number(params.pipelineId);

  if (!Number.isFinite(pipelineId) || pipelineId <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_pipeline_id",
        details: `Некоректний pipeline_id: ${params.pipelineId}`,
      },
      { status: 400 }
    );
  }

  const result = await fetchKeycrmPipelineDetail(pipelineId);

  if (result.ok === false) {
    const status =
      result.error === "keycrm_env_missing"
        ? 500
        : result.error === "keycrm_pipeline_not_found"
          ? 404
          : 502;

    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        details: result.details ?? null,
      },
      { status }
    );
  }

  const statuses = result.pipeline.statuses.map((status) => ({
    id: String(status.pipelineStatusId ?? status.statusId ?? status.id),
    name: status.title,
    pipelineStatusId:
      status.pipelineStatusId != null ? String(status.pipelineStatusId) : null,
    statusId: status.statusId != null ? String(status.statusId) : null,
  }));

  return NextResponse.json({
    ok: true,
    data: statuses,
    fetchedAt: result.fetchedAt,
  });
}
