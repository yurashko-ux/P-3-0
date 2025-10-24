// web/lib/manychat-routing.ts
// Спільна логіка пошуку кампанії, картки та переміщення у KeyCRM для ManyChat повідомлень.

import type { NormalizedMC } from '@/lib/ingest';
import { kvRead } from '@/lib/kv';
import {
  fetchKeycrmPipelineDetail,
  fetchKeycrmPipelines,
  type KeycrmPipeline,
} from '@/lib/keycrm-pipelines';
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
  pipelineStatusId: string | null;
  pipelineName: string | null;
  statusName: string | null;
  statusAliases: string[];
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
  requestUrl?: string | null;
  requestMethod?: string | null;
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
    requestUrl?: string | null;
    requestMethod?: string | null;
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
    pipelineStatusId?: string | null;
    statusAliases?: string[];
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

  const pipelineStatusId =
    toId((obj as any)?.pipeline_status_id) ??
    toId((obj as any)?.pipelineStatusId) ??
    toId((obj as any)?.pipeline_status) ??
    toId((obj as any)?.pipelineStatus) ??
    toId(campaign?.[`${fallbackStatus}_pipeline_status_id`]) ??
    toId(campaign?.[`${fallbackStatus}PipelineStatusId`]) ??
    toId(campaign?.[`${fallbackStatus}PipelineStatus`]);

  const statusAliases: string[] = [];
  const pushAlias = (value: unknown) => {
    const id = toId(value);
    if (!id) return;
    if (statusAliases.includes(id)) return;
    statusAliases.push(id);
  };

  pushAlias(obj?.status);
  pushAlias(obj?.status_id);
  pushAlias(obj?.pipeline_status_id);
  pushAlias(obj?.pipelineStatusId);
  pushAlias((obj as any)?.pipeline_status);
  pushAlias((obj as any)?.pipelineStatus);
  pushAlias(campaign?.[`${fallbackStatus}_pipeline_status_id`]);
  pushAlias(campaign?.[`${fallbackStatus}PipelineStatusId`]);
  pushAlias(campaign?.[`${fallbackStatus}PipelineStatus`]);
  pushAlias(campaign?.[`${fallbackStatus}_pipeline_status`]);
  pushAlias(campaign?.[`${fallbackStatus}_status_id`]);
  pushAlias(pipelineStatusId);

  const pipelineName =
    toName(obj?.pipelineName) ??
    toName(obj?.pipeline_name) ??
    toName(campaign?.[fallbackPipelineName ?? `${fallbackPipeline}_name`]);

  const statusName =
    toName(obj?.statusName) ??
    toName(obj?.status_name) ??
    toName(campaign?.[fallbackStatusName ?? `${fallbackStatus}_name`]);

  if (statusId && !statusAliases.includes(statusId)) {
    statusAliases.push(statusId);
  }

  if (pipelineStatusId && !statusAliases.includes(pipelineStatusId)) {
    statusAliases.push(pipelineStatusId);
  }

  return {
    pipelineId,
    statusId,
    pipelineStatusId,
    pipelineName,
    statusName,
    statusAliases,
  };
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
  target ?? {
    pipelineId: null,
    statusId: null,
    pipelineStatusId: null,
    pipelineName: null,
    statusName: null,
    statusAliases: [],
  };

const normaliseString = (value: string | null | undefined) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const sortPipelines = (list: KeycrmPipeline[]) =>
  [...list].sort((a, b) => {
    const posA = a.position ?? Number.MAX_SAFE_INTEGER;
    const posB = b.position ?? Number.MAX_SAFE_INTEGER;
    if (posA === posB) {
      return a.id - b.id;
    }
    return posA - posB;
  });

const equalsCI = (a: string | null, b: string | null) => {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

const resolveTargetWithPipelines = (
  input: TargetConfig | null | undefined,
  pipelines: KeycrmPipeline[],
): TargetConfig => {
  const target = formatTarget(input);
  const resolved: TargetConfig = {
    ...target,
    pipelineStatusId: target.pipelineStatusId ?? null,
    statusAliases: Array.isArray(target.statusAliases)
      ? [...target.statusAliases]
      : [],
  };

  const pushAlias = (value: unknown) => {
    const id = toId(value);
    if (!id) return;
    if (resolved.statusAliases.includes(id)) return;
    resolved.statusAliases.push(id);
  };

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
      status = pipeline.statuses.find((item) => {
        if (String(item.id) === statusIdRaw) return true;
        if (item.statusId != null && String(item.statusId) === statusIdRaw) return true;
        return item.aliases.some((alias) => String(alias) === statusIdRaw);
      }) ?? null;
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
          candidate.statuses.find((item) => {
            if (String(item.id) === statusIdRaw) return true;
            if (item.statusId != null && String(item.statusId) === statusIdRaw) return true;
            return item.aliases.some((alias) => String(alias) === statusIdRaw);
          }) ??
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
      status = pipeline.statuses.find((item) => {
        if (String(item.id) === statusIdRaw) return true;
        if (item.statusId != null && String(item.statusId) === statusIdRaw) return true;
        return item.aliases.some((alias) => String(alias) === statusIdRaw);
      }) ?? null;
    }

    if (!status && statusNameRaw) {
      status = pipeline.statuses.find((item) => equalsCI(item.title, statusNameRaw)) ?? null;
    }
  }

  if (status) {
    if (status.statusId != null && !resolved.statusId) {
      resolved.statusId = String(status.statusId);
    }
    if (!resolved.statusId) {
      resolved.statusId = String(status.id);
    }
    resolved.pipelineStatusId = String(
      status.pipelineStatusId ?? status.id,
    );
    resolved.statusName = status.title ?? statusNameRaw ?? target.statusName;
    if (status.statusId != null) {
      pushAlias(status.statusId);
    }
    if (status.pipelineStatusId != null) {
      pushAlias(status.pipelineStatusId);
    }
    status.aliases.forEach((alias) => pushAlias(alias));
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

  if (resolved.statusId && !resolved.statusAliases.includes(resolved.statusId)) {
    resolved.statusAliases.push(resolved.statusId);
  }

  if (
    resolved.pipelineStatusId &&
    !resolved.statusAliases.includes(resolved.pipelineStatusId)
  ) {
    resolved.statusAliases.push(resolved.pipelineStatusId);
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

  let pipelines: KeycrmPipeline[] = [];

  try {
    const pipelinesResult = await fetchKeycrmPipelines();
    pipelines = Array.isArray(pipelinesResult.pipelines)
      ? pipelinesResult.pipelines
      : [];
    if (pipelines.length) {
      base = resolveTargetWithPipelines(base, pipelines);
      target = resolveTargetWithPipelines(target, pipelines);
      if (!target.pipelineId && base.pipelineId) {
        target.pipelineId = base.pipelineId;
        target.pipelineName = target.pipelineName ?? base.pipelineName;
      }
      if (!target.pipelineStatusId && target.pipelineId) {
        target = resolveTargetWithPipelines(target, pipelines);
      }
    }
  } catch (err) {
    console.warn('Failed to resolve KeyCRM pipelines for ManyChat automation', err);
  }

  const pipelineIdsToHydrate = new Set<number>();

  const enqueuePipeline = (value: string | null) => {
    const id = toNumber(value ?? null);
    if (id == null) return;
    pipelineIdsToHydrate.add(id);
  };

  enqueuePipeline(base.pipelineId);
  enqueuePipeline(target.pipelineId);

  let pipelinesHydrated = false;

  for (const pipelineId of pipelineIdsToHydrate) {
    const existing = pipelines.find((item) => item.id === pipelineId) ?? null;
    const needsHydration =
      !existing ||
      existing.statuses.length === 0 ||
      existing.statuses.every((status) => status.pipelineStatusId == null);

    if (!needsHydration) {
      continue;
    }

    try {
      const detail = await fetchKeycrmPipelineDetail(pipelineId);
      if (!detail.ok || !detail.pipeline) {
        continue;
      }

      pipelines = sortPipelines([
        ...pipelines.filter((item) => item.id !== detail.pipeline.id),
        detail.pipeline,
      ]);

      pipelinesHydrated = true;
    } catch (detailErr) {
      console.warn('Failed to hydrate KeyCRM pipeline detail for ManyChat automation', {
        pipelineId,
        error: detailErr instanceof Error ? detailErr.message : String(detailErr),
      });
    }
  }

  if (pipelinesHydrated) {
    base = resolveTargetWithPipelines(base, pipelines);
    target = resolveTargetWithPipelines(target, pipelines);
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
  const statusNumber = toNumber(base.statusId ?? base.pipelineStatusId ?? null);

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
              pipelineStatusId: null,
              pipelineName: summary.pipelineTitle ?? null,
              statusName: summary.statusTitle ?? null,
              statusAliases:
                summary.statusId != null ? [String(summary.statusId)] : [],
            }
          : null,
      };
      break;
    }
  }

  if (selected?.summary && pipelines.length) {
    selected = {
      ...selected,
      summary: resolveTargetWithPipelines(selected.summary, pipelines),
    };
  }

  const campaignSummary = {
    id: toName(chosen.campaign?.id) ?? null,
    name: toName(chosen.campaign?.name) ?? null,
    base: formatTarget(base),
    target: formatTarget(target),
  };

  if (!campaignSummary.target.pipelineStatusId && !campaignSummary.target.statusId) {
    return error('campaign_target_status_missing', {
      normalized,
      campaign: campaignSummary,
      pipelines: pipelines.map((pipeline) => ({
        id: pipeline.id,
        title: pipeline.title,
        statuses: pipeline.statuses.map((status) => ({
          id: status.id,
          pipelineStatusId: status.pipelineStatusId,
          statusId: status.statusId,
          title: status.title,
        })),
      })),
    });
  }

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

  const baseStatusCandidates: string[] = [];
  if (base.pipelineStatusId) {
    const trimmed = base.pipelineStatusId.trim();
    if (trimmed) baseStatusCandidates.push(trimmed);
  }
  if (!baseStatusCandidates.length && base.statusId) {
    const trimmed = base.statusId.trim();
    if (trimmed) baseStatusCandidates.push(trimmed);
  }

  const basePipelineMatches =
    !base.pipelineId || selected.summary?.pipelineId === base.pipelineId;

  const baseStatusMatches =
    baseStatusCandidates.length === 0 ||
    baseStatusCandidates.some((candidate) => {
      const trimmed = candidate.trim();
      return (
        (selected.summary?.statusId && selected.summary.statusId === trimmed) ||
        (selected.summary?.pipelineStatusId && selected.summary.pipelineStatusId === trimmed)
      );
    });

  if (!basePipelineMatches || !baseStatusMatches) {
    return error('card_not_in_base', {
      normalized,
      campaign: campaignSummary,
      selected,
      summary: selected.summary,
      mismatch: {
        pipelineMatches: basePipelineMatches,
        statusMatches: baseStatusMatches,
      },
      base: formatTarget(base),
    });
  }

  const statusMatchCandidates = [
    target.statusId,
    target.pipelineStatusId,
    ...(target.statusAliases ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const pipelineMatchesTarget =
    !target.pipelineId || selected.summary?.pipelineId === target.pipelineId;

  const statusMatchesTarget = statusMatchCandidates.some((candidate) => {
    const trimmed = candidate.trim();
    return (
      (selected.summary?.statusId && selected.summary.statusId === trimmed) ||
      (selected.summary?.pipelineStatusId && selected.summary.pipelineStatusId === trimmed)
    );
  });

  const alreadyInTarget =
    pipelineMatchesTarget && statusMatchCandidates.length > 0 && statusMatchesTarget;

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
        requestUrl: null,
        requestMethod: null,
      },
    });
  }

  const resolvedPipelineId = (() => {
    const candidates = [target.pipelineId, selected.summary?.pipelineId, base.pipelineId];
    for (const candidate of candidates) {
      if (candidate == null) continue;
      const value = String(candidate).trim();
      if (value) {
        return value;
      }
    }
    return null;
  })();

  const targetPipelineStatusCandidates = [target.pipelineStatusId]
    .map((candidate) => (candidate == null ? null : String(candidate).trim()))
    .filter((candidate): candidate is string => Boolean(candidate));

  const targetStatusCandidates = [target.statusId, ...(target.statusAliases ?? [])]
    .map((candidate) => (candidate == null ? null : String(candidate).trim()))
    .filter((candidate): candidate is string => Boolean(candidate));

  const primaryPipelineStatusId =
    targetPipelineStatusCandidates.find((candidate) => candidate.length > 0) ?? null;

  const primaryStatusCandidate =
    targetStatusCandidates.find((candidate) => candidate.length > 0) ?? null;

  const directTargetStatusId =
    typeof target.statusId === 'string' ? target.statusId.trim() || null : null;

  const statusIdForMove =
    primaryPipelineStatusId ??
    directTargetStatusId ??
    primaryStatusCandidate ??
    null;

  const aliasCandidates = [...targetPipelineStatusCandidates, ...targetStatusCandidates]
    .map((candidate) => (candidate == null ? null : String(candidate).trim()))
    .filter((candidate): candidate is string => Boolean(candidate));

  const targetAliasSet = new Set<string>();
  for (const alias of aliasCandidates) {
    if (!alias) continue;
    if (statusIdForMove && alias === statusIdForMove) continue;
    targetAliasSet.add(alias);
  }

  const moveResult = await performMove({
    cardId,
    pipelineId: resolvedPipelineId,
    statusId: statusIdForMove,
    pipelineStatusId: primaryPipelineStatusId,
    statusAliases: Array.from(targetAliasSet),
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
        requestUrl: moveResult.requestUrl ?? null,
        requestMethod: moveResult.requestMethod ?? null,
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
      requestUrl: moveResult.requestUrl ?? null,
      requestMethod: moveResult.requestMethod ?? null,
    },
  });
}

export type {
  RuleConfig,
  TargetConfig,
  SearchAttempt,
};
