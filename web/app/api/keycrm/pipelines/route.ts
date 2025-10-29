// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from "next/server";

import {
  fetchKeycrmPipelineDetail,
  fetchKeycrmPipelines,
  type KeycrmPipelineDetailError,
  type KeycrmPipelineDetailResult,
  type KeycrmPipelineListError,
  type KeycrmPipelineListResult,
} from "@/lib/keycrm-pipelines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPipelineError(result: KeycrmPipelineListResult): result is KeycrmPipelineListError {
  return result.ok === false;
}

function isPipelineDetailError(result: KeycrmPipelineDetailResult): result is KeycrmPipelineDetailError {
  return result.ok === false;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pipelineParam = searchParams.get("pipeline_id") ?? searchParams.get("id");

  if (pipelineParam) {
    const pipelineId = Number(pipelineParam);
    if (!Number.isFinite(pipelineId) || pipelineId <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_pipeline_id",
          details: `Некоректний pipeline_id: ${pipelineParam}`,
          pipeline: null,
          fetchedAt: null,
        },
        { status: 400 }
      );
    }

    const result = await fetchKeycrmPipelineDetail(pipelineId);

    if (isPipelineDetailError(result)) {
      const status =
        result.error === "keycrm_env_missing"
          ? 500
          : result.error === "keycrm_pipeline_not_found"
            ? 404
            : 502;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  }

  const result = await fetchKeycrmPipelines();

  if (isPipelineError(result)) {
    const status = result.error === "keycrm_env_missing" ? 500 : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}

export async function POST() {
  const result = await fetchKeycrmPipelines({ forceRefresh: true, persist: true });

  if (isPipelineError(result)) {
    const status =
      result.error === "keycrm_env_missing"
        ? 500
        : result.error === "keycrm_fetch_failed"
          ? 502
          : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({ ...result, refreshed: true });
}
