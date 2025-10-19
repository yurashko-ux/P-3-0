import { NextRequest, NextResponse } from "next/server";

import { normalizeManyChat } from "@/lib/ingest";
import {
  persistManychatSnapshot,
  persistManychatAutomation,
  type ManychatStoredMessage,
  type ManychatWebhookTrace,
} from "@/lib/manychat-store";
import {
  routeManychatMessage,
  type ManychatRoutingError,
  type ManychatRoutingSuccess,
} from "@/lib/manychat-routing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SuccessPayload = ManychatRoutingSuccess;
type ErrorPayload = ManychatRoutingError;

const ERROR_STATUS: Record<string, number> = {
  invalid_json: 400,
  campaign_not_found: 404,
  campaign_base_missing: 400,
  campaign_target_missing: 400,
  identity_missing: 400,
  keycrm_search_failed: 502,
  card_not_found: 404,
  card_match_missing: 500,
  keycrm_move_failed: 502,
  host_header_missing: 500,
};

const bad = (status: number, error: string, details?: unknown) =>
  NextResponse.json<ErrorPayload>({ ok: false, error, ...(details ? { details } : {}) }, { status });

// ---- main handler ----
export async function POST(req: NextRequest) {
  let json: any;
  try {
    json = await req.json();
  } catch {
    return bad(400, "invalid_json");
  }

  const message = json?.message ?? json ?? {};

  const normalized = normalizeManyChat({
    username:
      message?.username ??
      message?.subscriber?.username ??
      message?.user?.username ??
      message?.handle ??
      json?.username ??
      json?.handle ??
      null,
    text:
      message?.text ??
      message?.message?.text ??
      message?.data?.text ??
      message?.message ??
      json?.text ??
      null,
    full_name:
      message?.full_name ??
      message?.name ??
      message?.subscriber?.name ??
      message?.user?.full_name ??
      json?.full_name ??
      json?.name ??
      null,
    first_name:
      message?.first_name ??
      message?.subscriber?.first_name ??
      message?.user?.first_name ??
      json?.first_name ??
      null,
    last_name:
      message?.last_name ??
      message?.subscriber?.last_name ??
      message?.user?.last_name ??
      json?.last_name ??
      null,
  });

  const snapshotTimestamp = Date.now();
  const snapshotMessage: ManychatStoredMessage = {
    id: `admin-test-${snapshotTimestamp}`,
    receivedAt: snapshotTimestamp,
    source: "admin:test/manychat",
    title: "ManyChat Admin Test",
    handle: normalized.handle ?? normalized.handleRaw ?? null,
    fullName: normalized.fullName || null,
    text: normalized.text || "",
    raw: { payload: json, normalized },
    rawText: (() => {
      try {
        return JSON.stringify({ payload: json, normalized });
      } catch {
        return null;
      }
    })(),
  };

  const snapshotTrace: ManychatWebhookTrace = {
    receivedAt: snapshotTimestamp,
    status: "accepted",
    handle: snapshotMessage.handle ?? undefined,
    fullName: snapshotMessage.fullName ?? undefined,
    messagePreview: snapshotMessage.text ? snapshotMessage.text.slice(0, 180) : null,
    reason: "Записано через /api/admin/test/manychat",
  };

  await persistManychatSnapshot(snapshotMessage, snapshotTrace).catch(() => {});

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host");

  if (!host) {
    return bad(500, "host_header_missing");
  }

  const moveEndpoint = `${proto}://${host}/api/keycrm/card/move`;

  const identityCandidates = [
    { kind: "override", value: json?.needle ?? null },
    { kind: "username", value: message?.username ?? null },
    { kind: "subscriber", value: message?.subscriber?.username ?? null },
    { kind: "handleRaw", value: normalized.handleRaw ?? null },
    { kind: "fullName", value: normalized.fullName ?? null },
  ];

  const automation = await routeManychatMessage({
    normalized,
    identityCandidates,
    performMove: async ({ cardId, pipelineId, statusId }) => {
      const res = await fetch(moveEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          card_id: cardId,
          to_pipeline_id: pipelineId,
          to_status_id: statusId,
        }),
        cache: "no-store",
      });

      const jsonBody = await res.json().catch(() => null);
      const okResult = res.ok && jsonBody && typeof jsonBody === "object" && jsonBody.ok !== false;
      if (!okResult) {
        return {
          ok: false,
          status: res.status,
          response: jsonBody,
        };
      }
      return {
        ok: true,
        status: res.status,
        response: jsonBody,
      };
    },
  });

  await persistManychatAutomation(automation).catch(() => {});

  if (!automation.ok) {
    const err = automation as ManychatRoutingError;
    const status = ERROR_STATUS[err.error] ?? 502;
    return NextResponse.json<ErrorPayload>(err, { status });
  }

  return NextResponse.json<SuccessPayload>(automation);
}
