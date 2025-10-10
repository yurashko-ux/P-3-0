// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from "next/server";

import {
  fetchKeycrmPipelines,
  type KeycrmPipelineListError,
  type KeycrmPipelineListResult,
} from "@/lib/keycrm-pipelines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPipelineError(result: KeycrmPipelineListResult): result is KeycrmPipelineListError {
  return result.ok === false;
}

export async function GET() {
  const result = await fetchKeycrmPipelines();

  if (isPipelineError(result)) {
    const status = result.error === "keycrm_env_missing" ? 500 : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}
