// web/app/api/cron/expire/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { kvRead, kvWrite, campaignKeys } from "@/lib/kv";
import {
  resolveExpirationConfig,
  getBaseEnteredCache,
  updateBaseCacheAfterMove,
  ensureCardStillInBase,
  extractEnteredAt,
  fetchCardDetail,
  thresholdFor,
} from "@/lib/campaign-exp";
import { Campaign } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_LIMIT = 50;

function normalizeToken(value?: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) return trimmed.slice(7);
  return trimmed;
}

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || "";
  const admin = process.env.ADMIN_PASS || "";
  const expected = cronSecret || admin;
  if (!expected) return true;

  const bearer = normalizeToken(req.headers.get("authorization"));
  const header = req.headers.get("x-cron-token") || "";
  const qs = req.nextUrl.searchParams.get("token") || req.nextUrl.searchParams.get("secret") || "";
  const cookie = req.cookies.get("admin_pass")?.value || "";

  return [bearer, header, qs, cookie].some((v) => v === expected);
}

function internalApiUrl(path: string) {
  const envBase =
    process.env.INTERNAL_API_BASE_URL ||
    process.env.CRON_INTERNAL_BASE_URL ||
    process.env.API_BASE_URL ||
    "";
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  const next = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "";
  const base = envBase || vercel || next || "http://127.0.0.1:3000";
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

async function moveCard(cardId: string, pipelineId: string, statusId: string) {
  const url = internalApiUrl("/api/keycrm/card/move");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      card_id: cardId,
      to_pipeline_id: pipelineId,
      to_status_id: statusId,
    }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  const ok = res.ok && (json?.ok === undefined || json?.ok === true);
  return { ok, status: res.status, body: json ?? text };
}

async function incrementExpCounter(campaignId: string) {
  const itemKey = campaignKeys.ITEM_KEY(campaignId);
  const raw = await kvRead.getRaw(itemKey);
  if (!raw) return false;
  try {
    const obj = JSON.parse(raw);
    const currentExp = typeof obj.exp_count === "number" ? obj.exp_count : 0;
    const countersExp = typeof obj?.counters?.exp === "number" ? obj.counters.exp : currentExp;
    obj.exp_count = currentExp + 1;
    if (obj.counters && typeof obj.counters === "object") {
      obj.counters.exp = countersExp + 1;
    }
    await kvWrite.setRaw(itemKey, JSON.stringify(obj));
    try { await kvWrite.lpush(campaignKeys.INDEX_KEY, campaignId); } catch {}
    return true;
  } catch {
    return false;
  }
}

type MoveLogEntry = {
  cardId: string;
  campaignId: string;
  enteredAt: number | null;
  enteredAtRaw?: string | null;
  movedAt: number;
  threshold: number;
};

async function appendLogs(campaignId: string, newEntries: MoveLogEntry[]) {
  if (!newEntries.length) return;
  const key = `cmp:exp-log:${campaignId}`;
  const stored = await kv.get<{ entries?: MoveLogEntry[] } | null>(key);
  const existing = Array.isArray(stored?.entries) ? stored!.entries! : [];
  const merged = [...newEntries, ...existing].slice(0, LOG_LIMIT);
  await kv.set(key, { entries: merged, updatedAt: Date.now() });
  await kv.set(`cmp:exp-last-run:${campaignId}`, Date.now());
}

function pickCampaigns(list: Campaign[]): Campaign[] {
  return list.filter((c) => c && c.active !== false && c.deleted !== true);
}

function ok(payload: any) {
  return NextResponse.json(payload);
}

function bad(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return bad(401, { ok: false, error: "unauthorized" });
  }

  let campaigns: Campaign[] = [];
  try { campaigns = await kvRead.listCampaigns<Campaign>(); } catch {}
  const active = pickCampaigns(campaigns);

  const now = Date.now();
  const summary: any[] = [];
  const errors: any[] = [];

  for (const campaign of active) {
    const config = resolveExpirationConfig(campaign);
    if (!config) continue;

    const cache = await getBaseEnteredCache(campaign.id);
    if (!cache || !cache.cards.length) continue;

    const threshold = thresholdFor(config, now);
    const due = cache.cards.filter((card) =>
      typeof card.enteredAt === "number" && Number.isFinite(card.enteredAt) && card.enteredAt <= threshold
    );
    if (!due.length) continue;

    const movedIds: string[] = [];
    const logs: MoveLogEntry[] = [];

    for (const card of due) {
      const stillInBase = await ensureCardStillInBase(
        card.cardId,
        config.basePipelineId,
        config.baseStatusId
      );
      if (!stillInBase) continue;

      const detail = await fetchCardDetail(card.cardId).catch(() => null);
      const parsed = detail ? extractEnteredAt(detail) : { ts: card.enteredAt ?? null, raw: card.enteredAtRaw ?? null };
      const enteredAt = parsed.ts ?? card.enteredAt ?? null;

      const move = await moveCard(card.cardId, config.targetPipelineId, config.targetStatusId);
      if (!move.ok) {
        errors.push({
          campaignId: campaign.id,
          cardId: card.cardId,
          status: move.status,
          response: move.body,
        });
        continue;
      }

      await incrementExpCounter(campaign.id);
      movedIds.push(card.cardId);
      logs.push({
        cardId: card.cardId,
        campaignId: campaign.id,
        enteredAt,
        enteredAtRaw: parsed.raw ?? card.enteredAtRaw ?? null,
        movedAt: Date.now(),
        threshold,
      });
    }

    if (!movedIds.length) continue;

    await updateBaseCacheAfterMove(campaign.id, movedIds);
    await appendLogs(campaign.id, logs);

    summary.push({
      campaignId: campaign.id,
      moved: movedIds.length,
      threshold,
      logs,
    });
  }

  return ok({ ok: true, processed: summary.length, summary, errors });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
