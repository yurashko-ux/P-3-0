// web/lib/campaign-exp.ts
import { kv } from "@vercel/kv";
import { Campaign, Target } from "@/lib/types";
import { assertKeycrmEnv, keycrmHeaders, keycrmUrl } from "@/lib/env";

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const PER_PAGE = 100;
const MAX_DEPTH = 4;

export type BaseEnteredCard = {
  cardId: string;
  pipelineId?: string | null;
  statusId?: string | null;
  enteredAt: number | null;
  enteredAtRaw?: string | null;
  fetchedAt: number;
};

export type BaseEnteredCache = {
  campaignId: string;
  pipelineId: string;
  statusId: string;
  updatedAt: number;
  cards: BaseEnteredCard[];
};

export type CollectBaseCardsResult = {
  ok: boolean;
  campaignId: string;
  pipelineId?: string;
  statusId?: string;
  updatedAt?: number;
  listed: number;
  detailFetched: number;
  cards: BaseEnteredCard[];
  errors: string[];
  message?: string;
};

export type ExpirationConfig = {
  basePipelineId: string;
  baseStatusId: string;
  targetPipelineId: string;
  targetStatusId: string;
  days: number;
};

export const baseEnteredKey = (campaignId: string) => `cmp:base-entered:${campaignId}`;

function pickId(...values: Array<string | number | null | undefined>): string {
  for (const value of values) {
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return "";
}

function resolveTargetIds(t?: Target | Record<string, any> | null) {
  if (!t) return { pipelineId: "", statusId: "" };
  const pipelineId = pickId(
    (t as any).pipeline,
    (t as any).pipeline_id,
    (t as any).pipelineId,
    (t as any).id
  );
  const statusId = pickId(
    (t as any).status,
    (t as any).status_id,
    (t as any).statusId
  );
  return { pipelineId, statusId };
}

export function resolveBasePair(campaign: Campaign): { pipelineId: string; statusId: string } | null {
  const baseTarget = campaign.base ?? (campaign as any).base ?? null;
  const { pipelineId, statusId } = resolveTargetIds(baseTarget);
  const fallbackPipeline = pickId((campaign as any).base_pipeline_id, (campaign as any).basePipelineId);
  const fallbackStatus = pickId((campaign as any).base_status_id, (campaign as any).baseStatusId);
  const finalPipeline = pipelineId || fallbackPipeline;
  const finalStatus = statusId || fallbackStatus;
  if (!finalPipeline || !finalStatus) return null;
  return { pipelineId: finalPipeline, statusId: finalStatus };
}

export function resolveExpirationConfig(campaign: Campaign): ExpirationConfig | null {
  const base = resolveBasePair(campaign);
  if (!base) return null;

  const expTarget = campaign.texp ?? (campaign as any).texp ?? (campaign as any).exp ?? null;
  const expObj = typeof (campaign as any).exp === "object" && !Array.isArray((campaign as any).exp)
    ? (campaign as any).exp
    : null;

  const { pipelineId: tPipeline, statusId: tStatus } = resolveTargetIds(expTarget as any);
  const pipelineFallback = pickId(expObj?.pipeline_id, expObj?.pipeline, (campaign as any).exp_pipeline_id);
  const statusFallback = pickId(expObj?.status_id, expObj?.status, (campaign as any).exp_status_id);
  const targetPipelineId = tPipeline || pipelineFallback;
  const targetStatusId = tStatus || statusFallback;

  const dayCandidates: Array<number | null> = [];
  const pushDay = (v: any) => {
    if (v == null) return;
    if (typeof v === "number" && Number.isFinite(v)) dayCandidates.push(v);
    else if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) dayCandidates.push(n);
    }
  };

  pushDay((campaign as any).expDays);
  pushDay((campaign as any).exp);
  pushDay((campaign as any).expireDays);
  pushDay((campaign as any).expire);
  pushDay((campaign as any).vexp);
  pushDay(expObj?.days);

  const days = dayCandidates.find((n) => (n ?? 0) > 0);
  if (!days || !targetPipelineId || !targetStatusId) return null;

  return {
    basePipelineId: base.pipelineId,
    baseStatusId: base.statusId,
    targetPipelineId: String(targetPipelineId),
    targetStatusId: String(targetStatusId),
    days: Number(days),
  };
}

export async function getBaseEnteredCache(campaignId: string): Promise<BaseEnteredCache | null> {
  const raw = await kv.get<BaseEnteredCache | null>(baseEnteredKey(campaignId));
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray((raw as any).cards)) return null;
  return {
    campaignId: String((raw as any).campaignId ?? campaignId),
    pipelineId: String((raw as any).pipelineId ?? ""),
    statusId: String((raw as any).statusId ?? ""),
    updatedAt: Number((raw as any).updatedAt ?? Date.now()),
    cards: ((raw as any).cards ?? []) as BaseEnteredCard[],
  };
}

async function saveBaseEnteredCache(payload: BaseEnteredCache) {
  await kv.set(baseEnteredKey(payload.campaignId), payload);
}

function toTimestamp(value: any): { ts: number | null; raw: string | null } {
  if (value == null) return { ts: null, raw: null };
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return { ts: value, raw: String(value) };
    if (value > 1e9) return { ts: value * 1000, raw: String(value) };
    return { ts: null, raw: String(value) };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { ts: null, raw: "" };
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return { ts: parsed, raw: trimmed };
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      if (num > 1e12) return { ts: num, raw: trimmed };
      if (num > 1e9) return { ts: num * 1000, raw: trimmed };
    }
    return { ts: null, raw: trimmed };
  }
  return { ts: null, raw: null };
}

function collectEnteredCandidates(obj: any, depth = 0, out: any[] = []): any[] {
  if (!obj || typeof obj !== "object" || depth > MAX_DEPTH) return out;
  for (const [key, value] of Object.entries(obj)) {
    if (/entered_at$/i.test(key)) {
      out.push(value);
    }
    if (value && typeof value === "object") {
      collectEnteredCandidates(value, depth + 1, out);
    }
  }
  return out;
}

async function fetchJson(path: string) {
  const url = keycrmUrl(path);
  const res = await fetch(url, { headers: keycrmHeaders(), cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KeyCRM ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`KeyCRM returned non-JSON for ${path}`);
  }
}

function extractList(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
}

function hasNextPage(payload: any, currentPage: number, perPage: number, itemsLength: number): boolean {
  const meta = payload?.meta ?? payload?.data?.meta ?? {};
  const nextUrl = payload?.links?.next ?? payload?.next_page_url ?? null;
  const current = Number(meta.current_page ?? payload?.current_page ?? currentPage);
  const last = Number(meta.last_page ?? payload?.last_page ?? current);
  if (Number.isFinite(current) && Number.isFinite(last)) {
    if (current < last) return true;
    return false;
  }
  if (nextUrl) return true;
  return itemsLength >= perPage;
}

export async function fetchCardDetail(cardId: string) {
  const payload = await fetchJson(`/pipelines/cards/${encodeURIComponent(cardId)}`);
  return payload?.data ?? payload;
}

export function extractEnteredAt(detail: any): { ts: number | null; raw: string | null } {
  const candidates = collectEnteredCandidates(detail);
  const first = candidates.length ? candidates[0] : null;
  return toTimestamp(first);
}

export async function collectBaseCards(campaign: Campaign): Promise<CollectBaseCardsResult> {
  const result: CollectBaseCardsResult = {
    ok: false,
    campaignId: String(campaign?.id ?? ""),
    listed: 0,
    detailFetched: 0,
    cards: [],
    errors: [],
  };

  if (!result.campaignId) {
    result.message = "campaign_id_missing";
    return result;
  }

  const base = resolveBasePair(campaign);
  if (!base) {
    result.message = "base_pair_missing";
    return result;
  }

  try {
    assertKeycrmEnv();
  } catch (e: any) {
    result.message = e?.message || "missing_keycrm_env";
    return result;
  }

  result.pipelineId = base.pipelineId;
  result.statusId = base.statusId;

  let page = 1;
  const ids: string[] = [];

  try {
    for (;;) {
      const qs = new URLSearchParams({
        page: String(page),
        per_page: String(PER_PAGE),
        pipeline_id: base.pipelineId,
        status_id: base.statusId,
      });
      const payload = await fetchJson(`/pipelines/cards?${qs.toString()}`);
      const items = extractList(payload);
      const idsPage = items.map((it: any) => pickId(it?.id, it?.card_id)).filter(Boolean);
      ids.push(...idsPage);
      result.listed += items.length;
      if (!hasNextPage(payload, page, PER_PAGE, items.length)) break;
      page += 1;
    }
  } catch (e: any) {
    result.message = e?.message || "cards_fetch_failed";
    result.errors.push(result.message);
    return result;
  }

  const cards: BaseEnteredCard[] = [];
  for (const id of ids) {
    try {
      const detail = await fetchCardDetail(id);
      result.detailFetched += 1;
      const parsed = extractEnteredAt(detail);
      cards.push({
        cardId: id,
        pipelineId: pickId(detail?.status?.pipeline_id, detail?.pipeline_id),
        statusId: pickId(detail?.status?.id, detail?.status_id),
        enteredAt: parsed.ts,
        enteredAtRaw: parsed.raw,
        fetchedAt: Date.now(),
      });
    } catch (e: any) {
      result.errors.push(`card ${id}: ${e?.message || e}`);
    }
  }

  const payload: BaseEnteredCache = {
    campaignId: result.campaignId,
    pipelineId: base.pipelineId,
    statusId: base.statusId,
    updatedAt: Date.now(),
    cards,
  };

  await saveBaseEnteredCache(payload);

  result.ok = true;
  result.cards = cards;
  result.updatedAt = payload.updatedAt;
  return result;
}

export async function updateBaseCacheAfterMove(
  campaignId: string,
  removedCardIds: string[]
): Promise<BaseEnteredCache | null> {
  const cache = await getBaseEnteredCache(campaignId);
  if (!cache) return null;
  if (!removedCardIds.length) return cache;
  const removed = new Set(removedCardIds.map(String));
  const nextCards = cache.cards.filter((card) => !removed.has(card.cardId));
  const updated: BaseEnteredCache = {
    ...cache,
    cards: nextCards,
    updatedAt: Date.now(),
  };
  await saveBaseEnteredCache(updated);
  return updated;
}

export function thresholdFor(config: ExpirationConfig, now: number) {
  return now - config.days * MS_IN_DAY;
}

export async function ensureCardStillInBase(
  cardId: string,
  basePipelineId: string,
  baseStatusId: string
): Promise<boolean> {
  try {
    const detail = await fetchCardDetail(cardId);
    const pipeline = pickId(detail?.status?.pipeline_id, detail?.pipeline_id);
    const status = pickId(detail?.status?.id, detail?.status_id);
    return pipeline === String(basePipelineId) && status === String(baseStatusId);
  } catch {
    return false;
  }
}
