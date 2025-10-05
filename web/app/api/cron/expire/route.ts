import { NextRequest, NextResponse } from "next/server";
import { kvRead, kvWrite, campaignKeys } from "@/lib/kv";
import { redis } from "@/lib/redis";
import { kv } from "@vercel/kv";
import { __KEYCRM_ENV } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

function envInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  const clamped = Math.max(min, Math.min(Math.floor(num), max));
  return clamped;
}

const PER_PAGE = envInt("EXP_CRON_PER_PAGE", 100, 1, 200);
const MAX_PAGES = envInt("EXP_CRON_MAX_PAGES", 50, 1, 200);
const MAX_MOVES = envInt("EXP_CRON_MAX_MOVES", 50, 1, 500);
const MAX_RECORDED_MOVES = envInt("EXP_CRON_MAX_LOG_MOVES", 20, 1, 100);

const KEYCRM_BASE = (__KEYCRM_ENV.BASE || "https://openapi.keycrm.app/v1").replace(/\/$/, "");
const KEYCRM_AUTH = __KEYCRM_ENV.AUTH || "";

type ExpConfig = {
  days: number;
  basePipelineId: string;
  baseStatusId: string;
  targetPipelineId: string;
  targetStatusId: string;
};

type CampaignSummary = {
  id: string;
  name: string;
  days: number;
  basePipelineId: string;
  baseStatusId: string;
  targetPipelineId: string;
  targetStatusId: string;
  totalCards: number;
  timestamped: number;
  withoutTimestamp: number;
  stale: number;
  moved: number;
  skippedByLimit: number;
  pages: number;
  limitReached: boolean;
  maxPagesReached: boolean;
  moves: {
    cardId: string;
    ageDays: number;
    statusUpdatedAt: string;
    updatedCounter?: string;
    error?: string;
  }[];
  errors: string[];
};

type CampaignCandidate = {
  raw: any;
  config: ExpConfig;
};

type CampaignSkip = { id: string; name: string; reason: string };

function keycrmHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (KEYCRM_AUTH) headers.Authorization = KEYCRM_AUTH;
  return headers;
}

function okCron(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "1") return true;

  const cronSecret = process.env.CRON_SECRET || process.env.EXP_CRON_SECRET || "";
  if (cronSecret) {
    const headerSecret = req.headers.get("x-cron-secret");
    if (headerSecret && headerSecret === cronSecret) return true;
    const querySecret =
      req.nextUrl.searchParams.get("secret") ||
      req.nextUrl.searchParams.get("cron_secret");
    if (querySecret && querySecret === cronSecret) return true;
  }

  const adminPass = process.env.ADMIN_PASS || process.env.ADMIN_TOKEN || "";
  if (!adminPass) return false;

  const headerAuth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (headerAuth) {
    const token = headerAuth.replace(/^Bearer\s+/i, "").trim();
    if (token && token === adminPass) return true;
  }

  const cookieToken =
    req.cookies.get("admin_token")?.value || req.cookies.get("admin_pass")?.value || "";
  if (cookieToken && cookieToken === adminPass) return true;

  const queryPass = req.nextUrl.searchParams.get("pass") || req.nextUrl.searchParams.get("token");
  if (queryPass && queryPass === adminPass) return true;

  return false;
}

function detectOrigin(req: NextRequest): string {
  const envUrl =
    process.env.CRON_BASE_URL ||
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL;
  if (envUrl) {
    if (/^https?:\/\//i.test(envUrl)) return envUrl.replace(/\/$/, "");
    return `https://${envUrl.replace(/\/$/, "")}`;
  }
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
  return `${proto}://${host}`;
}

function pickString(...inputs: any[]): string | null {
  for (const input of inputs) {
    if (input == null) continue;
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed) return trimmed;
    } else if (typeof input === "number") {
      if (Number.isFinite(input)) return String(input);
    } else if (typeof input === "object") {
      const nested = pickString(
        (input as any).id,
        (input as any).value,
        (input as any).pipeline,
        (input as any).status,
      );
      if (nested) return nested;
    }
  }
  return null;
}

function pickNumber(...inputs: any[]): number | null {
  for (const input of inputs) {
    if (input == null) continue;
    if (typeof input === "number") {
      if (Number.isFinite(input)) return input;
      continue;
    }
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) continue;
      const num = Number(trimmed);
      if (Number.isFinite(num)) return num;
    }
  }
  return null;
}

function parseTimestamp(value: any): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      if (trimmed.length <= 10) return asNumber * 1000;
      return asNumber;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function cardStatusTimestamp(card: any): number | null {
  if (!card || typeof card !== "object") return null;
  const candidates = [
    (card as any).status_updated_at,
    (card as any).pivot?.updated_at,
    (card as any).pivot?.status_updated_at,
    (card as any).status?.pivot?.updated_at,
    (card as any).status?.updated_at,
    (card as any).updated_at,
  ];
  for (const candidate of candidates) {
    const ts = parseTimestamp(candidate);
    if (ts) return ts;
  }
  return null;
}

async function fetchCardsPage(
  pipelineId: string,
  statusId: string,
  page: number,
  perPage: number,
) {
  const qs = new URLSearchParams({
    pipeline_id: String(pipelineId),
    status_id: String(statusId),
    page: String(page),
    per_page: String(perPage),
  });

  const res = await fetch(`${KEYCRM_BASE}/pipelines/cards?${qs.toString()}`, {
    method: "GET",
    headers: keycrmHeaders(),
    cache: "no-store",
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data?.message ||
      data?.error ||
      (typeof text === "string" && text ? text.slice(0, 400) : res.statusText);
    throw new Error(`KeyCRM ${res.status}: ${message}`);
  }

  const items = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data)
    ? data
    : [];

  const hasNext =
    Boolean(data?.next_page_url) ||
    Boolean(data?.links?.next) ||
    (typeof data?.meta?.current_page !== "undefined" &&
      typeof data?.meta?.last_page !== "undefined" &&
      Number(data.meta.current_page) < Number(data.meta.last_page)) ||
    items.length === perPage;

  return { items, hasNext };
}

async function moveCard(
  origin: string,
  cardId: string,
  toPipelineId: string,
  toStatusId: string,
) {
  try {
    const res = await fetch(`${origin}/api/keycrm/card/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_id: cardId,
        to_pipeline_id: toPipelineId,
        to_status_id: toStatusId,
      }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const error = data?.error || data?.responseText || res.statusText;
      return { ok: false as const, status: res.status, error, body: data };
    }
    return { ok: true as const, status: res.status, body: data };
  } catch (err: any) {
    return {
      ok: false as const,
      status: 0,
      error: err?.message || "move failed",
      body: null,
    };
  }
}

async function incrementExpCounter(campaignId: string) {
  let updated = false;
  let source: "primary" | "legacy" | undefined;

  const key = campaignKeys.ITEM_KEY(campaignId);
  try {
    const raw = await kvRead.getRaw(key);
    if (raw) {
      const obj = JSON.parse(raw);
      obj.exp_count = (typeof obj.exp_count === "number" ? obj.exp_count : 0) + 1;
      await kvWrite.setRaw(key, JSON.stringify(obj));
      try {
        await kvWrite.lpush(campaignKeys.INDEX_KEY, campaignId);
      } catch {
        /* ignore */
      }
      updated = true;
      source = "primary";
    }
  } catch {
    /* ignore */
  }

  if (updated) return { updated, source };

  try {
    const legacyKey = `cmp:item:${campaignId}`;
    const legacy = await kv.get<Record<string, any> | null>(legacyKey);
    if (legacy && typeof legacy === "object") {
      const counters = legacy.counters && typeof legacy.counters === "object" ? legacy.counters : {};
      const nextCounters = {
        v1: Number((counters as any).v1) || 0,
        v2: Number((counters as any).v2) || 0,
        exp: Number((counters as any).exp) || 0,
      };
      nextCounters.exp += 1;
      await kv.set(legacyKey, { ...legacy, counters: nextCounters });
      updated = true;
      source = "legacy";
    }
  } catch {
    /* ignore legacy errors */
  }

  return { updated, source };
}

async function loadLegacyCampaigns(): Promise<any[]> {
  try {
    const ids = await kv.lrange<string>("cmp:ids", 0, -1);
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!unique.length) return [];
    const keys = unique.map((id) => `cmp:item:${id}`);
    const items = await kv.mget(...keys);
    const out: any[] = [];
    unique.forEach((id, idx) => {
      const item = items[idx];
      if (item && typeof item === "object") {
        const withId = { ...(item as any) };
        withId.id = String((item as any).id ?? id);
        out.push(withId);
      }
    });
    return out;
  } catch {
    return [];
  }
}

async function loadCampaigns(): Promise<any[]> {
  const seen = new Set<string>();
  const out: any[] = [];

  try {
    const list = await kvRead.listCampaigns();
    for (const item of list) {
      const id = pickString(item?.id, item?.__index_id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }
  } catch {
    /* ignore primary read errors */
  }

  const legacy = await loadLegacyCampaigns();
  for (const item of legacy) {
    const id = pickString(item?.id, item?.__index_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }

  return out;
}

function resolveCampaign(raw: any): { config: ExpConfig | null; reason?: string } {
  if (!raw) return { config: null, reason: "empty" };
  if (raw.deleted) return { config: null, reason: "deleted" };
  if (raw.enabled === false || raw.active === false) return { config: null, reason: "disabled" };
  if (raw.exp && raw.exp.enabled === false) return { config: null, reason: "exp_disabled" };

  const basePipeline = pickString(
    raw.base_pipeline_id,
    raw.base?.pipeline,
    raw.base?.pipeline_id,
    raw.basePipelineId,
    raw.base_pipeline,
    raw.base_pipeline?.id,
  );
  if (!basePipeline) return { config: null, reason: "missing_base_pipeline" };

  const baseStatus = pickString(
    raw.base_status_id,
    raw.base?.status,
    raw.base?.status_id,
    raw.baseStatusId,
    raw.base_status,
    raw.base_status?.id,
  );
  if (!baseStatus) return { config: null, reason: "missing_base_status" };

  const targetPipeline = pickString(
    raw.exp_to_pipeline_id,
    raw.exp?.to_pipeline_id,
    raw.exp?.pipeline_id,
    raw.exp?.pipeline,
    raw.exp?.target_pipeline_id,
    raw.exp?.target?.pipeline_id,
    raw.texp?.pipeline,
    raw.texp?.pipeline_id,
  );
  if (!targetPipeline) return { config: null, reason: "missing_exp_pipeline" };

  const targetStatus = pickString(
    raw.exp_to_status_id,
    raw.exp?.to_status_id,
    raw.exp?.status_id,
    raw.exp?.status,
    raw.exp?.target_status_id,
    raw.exp?.target?.status_id,
    raw.texp?.status,
    raw.texp?.status_id,
  );
  if (!targetStatus) return { config: null, reason: "missing_exp_status" };

  const daysCandidate = pickNumber(
    raw.exp_days,
    raw.exp?.days,
    raw.exp?.value,
    raw.exp?.ttl_days,
    raw.exp?.duration_days,
    raw.exp?.exp_days,
    raw.expDays,
    raw.expireDays,
    raw.expire,
    raw.vexp,
  );
  if (daysCandidate == null) return { config: null, reason: "missing_exp_days" };
  const days = Math.floor(daysCandidate);
  if (!Number.isFinite(days) || days <= 0) return { config: null, reason: "invalid_exp_days" };

  return {
    config: {
      days,
      basePipelineId: String(basePipeline),
      baseStatusId: String(baseStatus),
      targetPipelineId: String(targetPipeline),
      targetStatusId: String(targetStatus),
    },
  };
}

async function prepareCampaigns() {
  const rawItems = await loadCampaigns();
  const eligible: CampaignCandidate[] = [];
  const skipped: CampaignSkip[] = [];

  for (const raw of rawItems) {
    const id = pickString(raw?.id, raw?.__index_id) || "";
    const name = typeof raw?.name === "string" ? raw.name : "";
    const { config, reason } = resolveCampaign(raw);
    if (config) {
      eligible.push({ raw: { ...raw, id }, config });
    } else {
      skipped.push({ id, name, reason: reason || "invalid" });
    }
  }

  return { eligible, skipped, total: rawItems.length };
}

async function processCampaign(
  candidate: CampaignCandidate,
  origin: string,
  now: number,
): Promise<CampaignSummary> {
  const { raw, config } = candidate;
  const summary: CampaignSummary = {
    id: String(raw?.id ?? ""),
    name: typeof raw?.name === "string" ? raw.name : "",
    days: config.days,
    basePipelineId: config.basePipelineId,
    baseStatusId: config.baseStatusId,
    targetPipelineId: config.targetPipelineId,
    targetStatusId: config.targetStatusId,
    totalCards: 0,
    timestamped: 0,
    withoutTimestamp: 0,
    stale: 0,
    moved: 0,
    skippedByLimit: 0,
    pages: 0,
    limitReached: false,
    maxPagesReached: false,
    moves: [],
    errors: [],
  };

  let page = 1;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    let pageData: { items: any[]; hasNext: boolean } | null = null;
    try {
      pageData = await fetchCardsPage(
        config.basePipelineId,
        config.baseStatusId,
        page,
        PER_PAGE,
      );
    } catch (err: any) {
      summary.errors.push(err?.message || String(err));
      hasMore = false;
      break;
    }

    summary.pages += 1;
    const items = Array.isArray(pageData?.items) ? pageData!.items : [];

    for (const card of items) {
      summary.totalCards += 1;
      const cardId = card?.id != null ? String(card.id) : "";
      if (!cardId) continue;
      const ts = cardStatusTimestamp(card);
      if (!ts) {
        summary.withoutTimestamp += 1;
        continue;
      }
      summary.timestamped += 1;
      const ageDays = (now - ts) / DAY_MS;
      if (ageDays < config.days) continue;

      summary.stale += 1;
      if (summary.moved >= MAX_MOVES) {
        summary.limitReached = true;
        summary.skippedByLimit += 1;
        continue;
      }

      const moveRes = await moveCard(
        origin,
        cardId,
        config.targetPipelineId,
        config.targetStatusId,
      );

      if (moveRes.ok) {
        summary.moved += 1;
        try {
          const counter = await incrementExpCounter(summary.id);
          if (summary.moves.length < MAX_RECORDED_MOVES) {
            summary.moves.push({
              cardId,
              ageDays: Number(ageDays.toFixed(2)),
              statusUpdatedAt: new Date(ts).toISOString(),
              updatedCounter: counter.updated ? counter.source ?? "primary" : undefined,
            });
          }
        } catch {
          if (summary.moves.length < MAX_RECORDED_MOVES) {
            summary.moves.push({
              cardId,
              ageDays: Number(ageDays.toFixed(2)),
              statusUpdatedAt: new Date(ts).toISOString(),
            });
          }
        }
      } else {
        const errText = moveRes.error || `move failed (status ${moveRes.status})`;
        summary.errors.push(`card ${cardId}: ${errText}`);
        if (summary.moves.length < MAX_RECORDED_MOVES) {
          summary.moves.push({
            cardId,
            ageDays: Number(ageDays.toFixed(2)),
            statusUpdatedAt: new Date(ts).toISOString(),
            error: errText,
          });
        }
      }
    }

    hasMore = Boolean(pageData?.hasNext);
    if (!hasMore) break;
    page += 1;
  }

  if (hasMore) summary.maxPagesReached = true;

  return summary;
}

async function logRun(payload: {
  durationMs: number;
  totalMoves: number;
  campaignsProcessed: number;
  campaignsSkipped: number;
  meta: { perPage: number; maxPages: number; maxMovesPerCampaign: number };
  campaigns: { id: string; name: string; moved: number; stale: number; errors: string[] }[];
}) {
  try {
    const id = `cron-expire:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
    const record = {
      ts: Date.now(),
      type: "cron_expire",
      ...payload,
    };
    await redis.set(`logs:${id}`, JSON.stringify(record));
    await redis.lpush("logs:index", id);
    await redis.ltrim("logs:index", 0, 499);
  } catch {
    /* logging is best-effort */
  }
}

async function handler(req: NextRequest) {
  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  if (!KEYCRM_AUTH) {
    return NextResponse.json({ ok: false, error: "missing KEYCRM_API_TOKEN" }, { status: 500 });
  }

  const started = Date.now();
  const { eligible, skipped, total } = await prepareCampaigns();
  const now = Date.now();
  const origin = detectOrigin(req);

  const summaries: CampaignSummary[] = [];
  let totalMoves = 0;
  let totalCards = 0;
  const aggregatedErrors: string[] = [];

  for (const candidate of eligible) {
    const summary = await processCampaign(candidate, origin, now);
    summaries.push(summary);
    totalMoves += summary.moved;
    totalCards += summary.totalCards;
    if (summary.errors.length) {
      for (const err of summary.errors) {
        aggregatedErrors.push(`${summary.id}: ${err}`);
      }
    }
  }

  const durationMs = Date.now() - started;

  const response = {
    ok: aggregatedErrors.length === 0,
    timestamp: new Date(now).toISOString(),
    durationMs,
    campaignsProcessed: summaries.length,
    campaignsSkipped: skipped.length,
    campaignsTotal: total,
    totalMoves,
    totalCardsScanned: totalCards,
    meta: {
      perPage: PER_PAGE,
      maxPages: MAX_PAGES,
      maxMovesPerCampaign: MAX_MOVES,
    },
    campaigns: summaries,
    skipped: skipped.slice(0, 50),
    errors: aggregatedErrors,
  };

  await logRun({
    durationMs,
    totalMoves,
    campaignsProcessed: summaries.length,
    campaignsSkipped: skipped.length,
    meta: response.meta,
    campaigns: summaries.map((c) => ({
      id: c.id,
      name: c.name,
      moved: c.moved,
      stale: c.stale,
      errors: c.errors.slice(0, 3),
    })),
  });

  return NextResponse.json(response, { status: 200 });
}

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}

