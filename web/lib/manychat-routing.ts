// web/lib/manychat-routing.ts
// Спільна логіка пошуку кампанії, картки та переміщення у KeyCRM для ManyChat повідомлень.

import type { NormalizedMC } from '@/lib/ingest';
import { kvRead } from '@/lib/kv';
import { fetchKeycrmPipelines, type KeycrmPipeline } from '@/lib/keycrm-pipelines';
import type { KeycrmMoveAttempt } from '@/lib/keycrm-move';
import {
  searchKeycrmCardByIdentity,
  type KeycrmCardSearchError,
  type KeycrmCardSearchResult,
} from '@/lib/keycrm-card-search';

type RuleConfig = { op: 'contains' | 'equals'; value: string };

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

type MoveResult = {
  ok: boolean;
  status?: number;
  response?: unknown;
  skippedReason?: string;
  sent?: Record<string, unknown> | null;
  attempts?: KeycrmMoveAttempt[];
};

export type ManychatRoutingSuccess = {
  ok: true;
  normalized: NormalizedMC;
  match: {
    route: 'v1' | 'v2';
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
    selected: (KeycrmCardSearchResult & { summary: TargetConfig | null }) | null;
  };
  move: {
    attempted: boolean;
    skippedReason?: string;
    response?: unknown;
    status?: number;
    ok: boolean;
    error?: string;
    details?: unknown;
    sent?: Record<string, unknown> | null;
    attempts?: KeycrmMoveAttempt[];
  };
};

export type ManychatRoutingError = {
  ok: false;
  error: string;
  details?: unknown;
};

export type ManychatRoutingOptions = {
  normalized: NormalizedMC;
  identityCandidates?: Array<{ kind: string; value: string | null | undefined }>;
  campaigns?: CampaignRecord[];
  performMove?: (params: {
    cardId: number | string;
    pipelineId: string | null;
    statusId: string | null;
  }) => Promise<MoveResult>;
};

const toId = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

const toName = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

const readRule = (campaign: CampaignRecord, variant: 'v1' | 'v2'): RuleConfig | null => {
  const fromRules = campaign?.rules?.[variant];
  if (fromRules?.value) {
    return {
      value: String(fromRules.value),
      op: fromRules.op === 'equals' ? 'equals' : 'contains',
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

  const op = opCandidate === 'equals' ? 'equals' : 'contains';

  return { value, op };
};

const readTarget = (
  campaign: CampaignRecord,
  key: 'base' | 't1' | 't2',
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
  if (rule.op === 'equals') {
    return hay === needle;
  }
  return hay.includes(needle);
};

const toNumber = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const uniqueStrings = (values: Array<{ kind: string; value: string | null | undefined }>) => {
  const seen = new Set<string>();
  const out: Array<{ kind: string; value: string }> = [];
  for (const item of values) {
    const value = typeof item.value === 'string' ? item.value.trim() : '';
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

const normaliseString = (value: string | null | undefined) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const equalsCI = (a: string | null, b: string | null) => {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

const resolveTargetWithPipelines = (
  input: TargetConfig | null | undefined,
  pipelines: KeycrmPipeline[],
): TargetConfig => {
  const target = formatTarget(input);
  const resolved: TargetConfig = { ...target };

  const pipelinesList = Array.isArray(pipelines) ? pipelines : [];

  const pipelineIdRaw = normaliseString(target.pipelineId);
  const pipelineNameRaw = normaliseString(target.pipelineName);
  const statusIdRaw = normaliseString(target.statusId);
  const statusNameRaw = normaliseString(target.statusName);

  let pipeline: KeycrmPipeline | null = null;
  let status: (KeycrmPipeline['statuses'][number]) | null = null;

  const findPipeline = (predicate: (item: KeycrmPipeline) => boolean) =>
    pipelinesList.find(predicate) ?? null;

  if (pipelineIdRaw) {
    pipeline = findPipeline((item) => String(item.id) === pipelineIdRaw);
  }

  if (!pipeline && pipelineNameRaw) {
    pipeline = findPipeline((item) => equalsCI(item.title, pipelineNameRaw));
  }

  if (!pipeline && pipelineIdRaw) {
    pipeline = findPipeline((item) => equalsCI(item.title, pipelineIdRaw));
  }

  if (pipeline) {
    if (statusIdRaw) {
      status = pipeline.statuses.find((item) => String(item.id) === statusIdRaw) ?? null;
    }

    if (!status && statusNameRaw) {
      status = pipeline.statuses.find((item) => equalsCI(item.title, statusNameRaw)) ?? null;
    }
  }

  if (!pipeline && (statusIdRaw || statusNameRaw)) {
    const match = pipelinesList
      .map((candidate) => ({
        pipeline: candidate,
        status:
          candidate.statuses.find((item) => String(item.id) === statusIdRaw) ??
          candidate.statuses.find((item) => equalsCI(item.title, statusIdRaw)) ??
          candidate.statuses.find((item) => equalsCI(item.title, statusNameRaw)),
      }))
      .find((entry) => entry.status);

    if (match) {
      pipeline = match.pipeline;
      status = match.status ?? null;
    }
  }

  if (pipeline) {
    resolved.pipelineId = String(pipeline.id);
    resolved.pipelineName = pipeline.title ?? pipelineNameRaw ?? target.pipelineName;

    if (!status && statusIdRaw) {
      status = pipeline.statuses.find((item) => String(item.id) === statusIdRaw) ?? null;
    }

    if (!status && statusNameRaw) {
      status = pipeline.statuses.find((item) => equalsCI(item.title, statusNameRaw)) ?? null;
    }
  }

  if (status) {
    resolved.statusId = String(status.id);
    resolved.statusName = status.title ?? statusNameRaw ?? target.statusName;
    if (!pipeline) {
      const owningPipeline = pipelinesList.find((candidate) =>
        candidate.statuses.some((item) => String(item.id) === String(status?.id)),
      );
      if (owningPipeline) {
        resolved.pipelineId = String(owningPipeline.id);
        resolved.pipelineName = owningPipeline.title ?? resolved.pipelineName;
      }
    }
  }

  return resolved;
};

const success = (payload: Omit<ManychatRoutingSuccess, 'ok'>): ManychatRoutingSuccess => ({
  ok: true,
  ...payload,
});

const error = (errorCode: string, details?: unknown): ManychatRoutingError => ({
  ok: false,
  error: errorCode,
  ...(details ? { details } : {}),
});

export async function routeManychatMessage({
  normalized,
  identityCandidates = [],
  campaigns,
  performMove,
}: ManychatRoutingOptions): Promise<ManychatRoutingSuccess | ManychatRoutingError> {
  const campaignsList = campaigns ?? (await kvRead.listCampaigns<CampaignRecord>());
  const activeCampaigns = campaignsList.filter(isActiveCampaign);

  const text = normalized.text?.trim() ?? '';

  let chosen: { campaign: CampaignRecord; route: 'v1' | 'v2'; rule: RuleConfig } | null = null;
  const ruleDiagnostics: Array<{
    id: string | null;
    name: string | null;
    v1: boolean;
    v2: boolean;
  }> = [];

  for (const campaign of activeCampaigns) {
    const ruleV1 = readRule(campaign, 'v1');
    const ruleV2 = readRule(campaign, 'v2');
    const matchV1 = matchRule(text, ruleV1);
    const matchV2 = matchRule(text, ruleV2);

    ruleDiagnostics.push({
      id: toName(campaign?.id) ?? toName(campaign?.__index_id) ?? null,
      name: toName(campaign?.name),
      v1: matchV1,
      v2: matchV2,
    });

    if (!chosen) {
      if (matchV1 && ruleV1) {
        chosen = { campaign, route: 'v1', rule: ruleV1 };
      } else if (matchV2 && ruleV2) {
        chosen = { campaign, route: 'v2', rule: ruleV2 };
      }
    }
  }

  if (!chosen) {
    return error('campaign_not_found', { normalized, matches: ruleDiagnostics });
  }

  let base = readTarget(
    chosen.campaign,
    'base',
    'base_pipeline_id',
    'base_status_id',
    'base_pipeline_name',
    'base_status_name',
  );

  let target = readTarget(
    chosen.campaign,
    chosen.route === 'v1' ? 't1' : 't2',
    chosen.route === 'v1' ? 'v1_to_pipeline_id' : 'v2_to_pipeline_id',
    chosen.route === 'v1' ? 'v1_to_status_id' : 'v2_to_status_id',
    chosen.route === 'v1' ? 'v1_to_pipeline_name' : 'v2_to_pipeline_name',
    chosen.route === 'v1' ? 'v1_to_status_name' : 'v2_to_status_name',
  );

  try {
    const pipelinesResult = await fetchKeycrmPipelines();
    const pipelines: KeycrmPipeline[] = Array.isArray(pipelinesResult.pipelines)
      ? pipelinesResult.pipelines
      : [];
    if (pipelines.length) {
      base = resolveTargetWithPipelines(base, pipelines);
      target = resolveTargetWithPipelines(target, pipelines);
    }
  } catch (err) {
    console.warn('Failed to resolve KeyCRM pipelines for ManyChat automation', err);
  }

  if (!base.pipelineId) {
    return error('campaign_base_missing', {
      normalized,
      match: ruleDiagnostics,
      campaign: {
        id: toName(chosen.campaign?.id) ?? null,
        name: toName(chosen.campaign?.name) ?? null,
      },
    });
  }

  if (!target.pipelineId && !target.statusId) {
    return error('campaign_target_missing', {
      normalized,
      match: ruleDiagnostics,
      campaign: {
        id: toName(chosen.campaign?.id) ?? null,
        name: toName(chosen.campaign?.name) ?? null,
      },
    });
  }

  const needles = uniqueStrings([
    ...identityCandidates,
    { kind: 'handle', value: normalized.handle },
    { kind: 'handleRaw', value: normalized.handleRaw },
    { kind: 'fullName', value: normalized.fullName },
  ]);

  if (!needles.length) {
    return error('identity_missing', { normalized });
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
      selected = {
        ...result,
        summary: summary
          ? {
              pipelineId: summary.pipelineId != null ? String(summary.pipelineId) : null,
              statusId: summary.statusId != null ? String(summary.statusId) : null,
              pipelineName: summary.pipelineTitle ?? null,
              statusName: summary.statusTitle ?? null,
            }
          : null,
      };
      break;
    }
  }

  const campaignSummary = {
    id: toName(chosen.campaign?.id) ?? null,
    name: toName(chosen.campaign?.name) ?? null,
    base: formatTarget(base),
    target: formatTarget(target),
  };

  if (!selected) {
    if (searchError) {
      return error('keycrm_search_failed', {
        attempts,
        error: searchError,
        campaign: campaignSummary,
      });
    }

    return error('card_not_found', {
      attempts,
      normalized,
      campaign: campaignSummary,
    });
  }

  const cardId = selected.match?.cardId ?? null;

  if (!cardId) {
    return error('card_match_missing', { selected, campaign: campaignSummary });
  }

  const alreadyInTarget =
    (!!target.pipelineId && selected.summary?.pipelineId === target.pipelineId) &&
    (!target.statusId || selected.summary?.statusId === target.statusId);

  if (alreadyInTarget) {
    return success({
      normalized,
      match: {
        route: chosen.route,
        rule: chosen.rule,
        campaign: campaignSummary,
      },
      search: {
        usedNeedle,
        attempts,
        selected,
      },
      move: {
        attempted: false,
        skippedReason: 'already_in_target',
        ok: true,
      },
    });
  }

  if (!performMove) {
    return success({
      normalized,
      match: {
        route: chosen.route,
        rule: chosen.rule,
        campaign: campaignSummary,
      },
      search: {
        usedNeedle,
        attempts,
        selected,
      },
      move: {
        attempted: false,
        skippedReason: 'move_handler_missing',
        ok: false,
      },
    });
  }

  const moveResult = await performMove({
    cardId,
    pipelineId: target.pipelineId,
    statusId: target.statusId,
  });

  const baseResult = {
    normalized,
    match: {
      route: chosen.route,
      rule: chosen.rule,
      campaign: campaignSummary,
    },
    search: {
      usedNeedle,
      attempts,
      selected,
    },
  } as const;

  if (!moveResult.ok) {
    return success({
      ...baseResult,
      move: {
        attempted: true,
        response: moveResult.response,
        status: moveResult.status,
        ok: false,
        error: 'keycrm_move_failed',
        details: {
          skippedReason: moveResult.skippedReason ?? null,
        },
        skippedReason: moveResult.skippedReason ?? undefined,
        sent: moveResult.sent ?? null,
        attempts: moveResult.attempts,
      },
    });
  }

  return success({
    ...baseResult,
    move: {
      attempted: true,
      response: moveResult.response,
      status: moveResult.status,
      ok: true,
      skippedReason: moveResult.skippedReason ?? undefined,
      sent: moveResult.sent ?? null,
      attempts: moveResult.attempts,
    },
  });
}

export type {
  RuleConfig,
  TargetConfig,
  SearchAttempt,
};
