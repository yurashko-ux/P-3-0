import { NextRequest, NextResponse } from "next/server";

import { normalizeManyChat } from "@/lib/ingest";
import { kvRead } from "@/lib/kv";
import {
  persistManychatSnapshot,
  type ManychatStoredMessage,
  type ManychatWebhookTrace,
} from "@/lib/manychat-store";
import {
  searchKeycrmCardByIdentity,
  type KeycrmCardSearchResult,
  type KeycrmCardSearchError,
} from "@/lib/keycrm-card-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- helper types ----
type RuleConfig = { op: "contains" | "equals"; value: string };

type TargetConfig = {
  pipelineId: string | null;
  statusId: string | null;
  pipelineName: string | null;
  statusName: string | null;
};

type CampaignRecord = Record<string, any> & {
  id?: string;
  name?: string;
};

type SearchAttempt = {
  kind: string;
  value: string;
  result: KeycrmCardSearchResult | KeycrmCardSearchError;
};

type SuccessPayload = {
  ok: true;
  normalized: ReturnType<typeof normalizeManyChat>;
  match: {
    route: "v1" | "v2";
    rule: RuleConfig;
    campaign: {
      id: string | null;
      name: string | null;
      base: TargetConfig;
      target: TargetConfig;
    };
  };
  search: {
    usedNeedle: string | null;
    attempts: SearchAttempt[];
    selected:
      | (KeycrmCardSearchResult & { summary: TargetConfig | null })
      | null;
  };
  move: {
    attempted: boolean;
    skippedReason?: string;
    response?: unknown;
    status?: number;
    ok: boolean;
  };
};

type ErrorPayload = {
  ok: false;
  error: string;
  details?: unknown;
};

// ---- helpers ----
const toId = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

const toName = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

const readRule = (campaign: CampaignRecord, variant: "v1" | "v2"): RuleConfig | null => {
  const fromRules = campaign?.rules?.[variant];
  if (fromRules?.value) {
    return {
      value: String(fromRules.value),
      op: fromRules.op === "equals" ? "equals" : "contains",
    };
  }

  const valueCandidate =
    campaign?.[variant]?.value ??
    campaign?.[variant] ??
    campaign?.[`${variant}_value`] ??
    campaign?.[`${variant}Value`];

  const opCandidate =
    campaign?.[`${variant}_op`] ??
    campaign?.[`${variant}Op`];

  const value = toName(valueCandidate);
  if (!value) return null;

  const op = opCandidate === "equals" ? "equals" : "contains";

  return { value, op };
};

const readTarget = (
  campaign: CampaignRecord,
  key: "base" | "t1" | "t2",
  fallbackPipeline: string,
  fallbackStatus: string,
  fallbackPipelineName?: string,
  fallbackStatusName?: string,
): TargetConfig => {
  const obj = campaign?.[key] ?? {};

  const pipelineId =
    toId(obj?.pipeline) ??
    toId(obj?.pipeline_id) ??
    toId(obj?.id) ??
    toId(campaign?.[fallbackPipeline]);

  const statusId =
    toId(obj?.status) ??
    toId(obj?.status_id) ??
    toId(obj?.id) ??
    toId(campaign?.[fallbackStatus]);

  const pipelineName =
    toName(obj?.pipelineName) ??
    toName(obj?.pipeline_name) ??
    toName(campaign?.[fallbackPipelineName ?? `${fallbackPipeline}_name`]);

  const statusName =
    toName(obj?.statusName) ??
    toName(obj?.status_name) ??
    toName(campaign?.[fallbackStatusName ?? `${fallbackStatus}_name`]);

  return { pipelineId, statusId, pipelineName, statusName };
};

const isActiveCampaign = (campaign: CampaignRecord): boolean => {
  if (!campaign) return false;
  if (campaign.deleted === true) return false;
  if (campaign.active === false) return false;
  if (campaign.enabled === false) return false;
  return true;
};

const matchRule = (text: string, rule: RuleConfig | null): boolean => {
  if (!rule || !rule.value) return false;
  const hay = text.toLowerCase();
  const needle = rule.value.toLowerCase();
  if (!needle) return false;
  if (rule.op === "equals") {
    return hay === needle;
  }
  return hay.includes(needle);
};

const toNumber = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const uniqueStrings = (values: Array<{ kind: string; value: string | null }>) => {
  const seen = new Set<string>();
  const out: Array<{ kind: string; value: string }> = [];
  for (const item of values) {
    const value = item.value?.trim();
    if (!value) continue;
    const key = `${item.kind}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: item.kind, value });
  }
  return out;
};

const formatTarget = (target: TargetConfig | null | undefined) =>
  target ?? { pipelineId: null, statusId: null, pipelineName: null, statusName: null };

const bad = (status: number, error: string, details?: unknown) =>
  NextResponse.json<ErrorPayload>({ ok: false, error, ...(details ? { details } : {}) }, { status });

const ok = (payload: SuccessPayload) => NextResponse.json<SuccessPayload>(payload);

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

  const text = normalized.text?.trim() ?? "";

  const campaigns = await kvRead.listCampaigns<CampaignRecord>();
  const activeCampaigns = campaigns.filter(isActiveCampaign);

  let chosen: { campaign: CampaignRecord; route: "v1" | "v2"; rule: RuleConfig } | null = null;
  const ruleDiagnostics: Array<{
    id: string | null;
    name: string | null;
    v1: boolean;
    v2: boolean;
  }> = [];

  for (const campaign of activeCampaigns) {
    const ruleV1 = readRule(campaign, "v1");
    const ruleV2 = readRule(campaign, "v2");
    const matchV1 = matchRule(text, ruleV1);
    const matchV2 = matchRule(text, ruleV2);

    ruleDiagnostics.push({
      id: toName(campaign?.id) ?? toName(campaign?.__index_id) ?? null,
      name: toName(campaign?.name),
      v1: matchV1,
      v2: matchV2,
    });

    if (!chosen) {
      if (matchV1) {
        chosen = { campaign, route: "v1", rule: ruleV1! };
      } else if (matchV2) {
        chosen = { campaign, route: "v2", rule: ruleV2! };
      }
    }
  }

  if (!chosen) {
    return bad(404, "campaign_not_found", {
      normalized,
      matches: ruleDiagnostics,
    });
  }

  const base = readTarget(
    chosen.campaign,
    "base",
    "base_pipeline_id",
    "base_status_id",
    "base_pipeline_name",
    "base_status_name",
  );

  const target = readTarget(
    chosen.campaign,
    chosen.route === "v1" ? "t1" : "t2",
    chosen.route === "v1" ? "v1_to_pipeline_id" : "v2_to_pipeline_id",
    chosen.route === "v1" ? "v1_to_status_id" : "v2_to_status_id",
    chosen.route === "v1" ? "v1_to_pipeline_name" : "v2_to_pipeline_name",
    chosen.route === "v1" ? "v1_to_status_name" : "v2_to_status_name",
  );

  if (!base.pipelineId) {
    return bad(400, "campaign_base_missing", {
      normalized,
      match: ruleDiagnostics,
      campaign: {
        id: toName(chosen.campaign?.id) ?? null,
        name: toName(chosen.campaign?.name) ?? null,
      },
    });
  }

  if (!target.pipelineId && !target.statusId) {
    return bad(400, "campaign_target_missing", {
      normalized,
      match: ruleDiagnostics,
      campaign: {
        id: toName(chosen.campaign?.id) ?? null,
        name: toName(chosen.campaign?.name) ?? null,
      },
    });
  }

  const needles = uniqueStrings([
    { kind: "override", value: json?.needle ?? null },
    { kind: "handle", value: normalized.handle ?? null },
    { kind: "handleRaw", value: normalized.handleRaw ?? null },
    { kind: "fullName", value: normalized.fullName ?? null },
  ]);

  if (!needles.length) {
    return bad(400, "identity_missing", { normalized });
  }

  const pipelineNumber = toNumber(base.pipelineId);
  const statusNumber = toNumber(base.statusId);

  const attempts: SearchAttempt[] = [];
  let selected: (KeycrmCardSearchResult & { summary: TargetConfig | null }) | null = null;
  let usedNeedle: string | null = null;
  let searchError: KeycrmCardSearchError | null = null;

  for (const needle of needles) {
    const result = await searchKeycrmCardByIdentity({
      needle: needle.value,
      pipelineId: pipelineNumber,
      statusId: statusNumber,
    });

    attempts.push({ kind: needle.kind, value: needle.value, result });

    if (!result.ok) {
      searchError = result as KeycrmCardSearchError;
      continue;
    }

    if (result.match) {
      usedNeedle = needle.value;
      const summary = result.items.find((item) => item.cardId === result.match?.cardId);
      selected = { ...result, summary: summary ? {
        pipelineId: summary.pipelineId != null ? String(summary.pipelineId) : null,
        statusId: summary.statusId != null ? String(summary.statusId) : null,
        pipelineName: summary.pipelineTitle ?? null,
        statusName: summary.statusTitle ?? null,
      } : null };
      break;
    }
  }

  if (!selected) {
    if (searchError) {
      return bad(502, "keycrm_search_failed", {
        attempts,
        error: searchError,
      });
    }

    return bad(404, "card_not_found", {
      attempts,
      normalized,
      campaign: {
        id: toName(chosen.campaign?.id) ?? null,
        name: toName(chosen.campaign?.name) ?? null,
      },
    });
  }

  const cardId = selected.match?.cardId ?? null;

  if (!cardId) {
    return bad(500, "card_match_missing", { selected });
  }

  const alreadyInTarget =
    (!!target.pipelineId && selected.summary?.pipelineId === target.pipelineId) &&
    (!target.statusId || selected.summary?.statusId === target.statusId);

  if (alreadyInTarget) {
    return ok({
      ok: true,
      normalized,
      match: {
        route: chosen.route,
        rule: chosen.rule,
        campaign: {
          id: toName(chosen.campaign?.id) ?? null,
          name: toName(chosen.campaign?.name) ?? null,
          base: formatTarget(base),
          target: formatTarget(target),
        },
      },
      search: {
        usedNeedle,
        attempts,
        selected,
      },
      move: {
        attempted: false,
        skippedReason: "already_in_target",
        ok: true,
      },
    });
  }

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host");

  if (!host) {
    return bad(500, "host_header_missing");
  }

  const moveRes = await fetch(`${proto}://${host}/api/keycrm/card/move`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      card_id: cardId,
      to_pipeline_id: target.pipelineId,
      to_status_id: target.statusId,
    }),
    cache: "no-store",
  });

  const moveJson = await moveRes.json().catch(() => null);
  const moveOk = moveRes.ok && moveJson && typeof moveJson === "object" && moveJson.ok !== false;

  if (!moveOk) {
    return bad(moveRes.status || 502, "keycrm_move_failed", {
      response: moveJson,
      status: moveRes.status,
    });
  }

  return ok({
    ok: true,
    normalized,
    match: {
      route: chosen.route,
      rule: chosen.rule,
      campaign: {
        id: toName(chosen.campaign?.id) ?? null,
        name: toName(chosen.campaign?.name) ?? null,
        base: formatTarget(base),
        target: formatTarget(target),
      },
    },
    search: {
      usedNeedle,
      attempts,
      selected,
    },
    move: {
      attempted: true,
      response: moveJson,
      status: moveRes.status,
      ok: true,
    },
  });
}
