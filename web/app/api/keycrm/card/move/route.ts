import { NextRequest, NextResponse } from "next/server";

import { moveKeycrmCard, normalizeId } from "@/lib/keycrm-move";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MoveBody = {
  card_id?: string | number | null;
  to_pipeline_id?: string | number | null;
  to_status_id?: string | number | null;
};

const bad = (status: number, error: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });

const ok = (extra?: Record<string, unknown>) =>
  NextResponse.json({ ok: true, ...(extra ?? {}) });

export async function POST(req: NextRequest) {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as MoveBody;

  const cardId = normalizeId(body.card_id);
  const toPipelineId = normalizeId(body.to_pipeline_id);
  const toStatusId = normalizeId(body.to_status_id);

  if (!cardId) return bad(400, "card_id required");
  if (!toPipelineId && !toStatusId) {
    return bad(400, "to_pipeline_id or to_status_id required");
  }

  try {
    const result = await moveKeycrmCard({
      cardId,
      pipelineId: toPipelineId,
      statusId: toStatusId,
    });

    if (!result.ok) {
      return bad(502, "keycrm move unverified", result);
    }

    return ok({
      moved: true,
      via: "pipelines/cards/{id} PUT",
      status: result.status,
      response: result.response,
      attempts: result.attempts,
      sent: result.sent,
    });
  } catch (err) {
    const error = err as { code?: string; message?: string } | Error;

    if ((error as any)?.code === "keycrm_not_configured") {
      return bad(500, "keycrm not configured", {
        need: {
          KEYCRM_API_TOKEN: !!process.env.KEYCRM_API_TOKEN,
          KEYCRM_BASE_URL: !!process.env.KEYCRM_BASE_URL,
        },
      });
    }

    if ((error as any)?.code === "target_missing") {
      return bad(400, "to_pipeline_id or to_status_id required");
    }

    return bad(502, "keycrm move failed", {
      error: error?.message ?? String(error),
    });
  }
}
