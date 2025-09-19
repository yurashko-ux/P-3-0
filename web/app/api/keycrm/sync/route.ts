// web/app/api/keycrm/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign } from '@/lib/types';

// KV keys
const KC_CARD_KEY = (id: number | string) => `kc:card:${id}`;
const KC_INDEX_PAIR = (p: number, s: number) => `kc:index:cards:${p}:${s}`;
const KC_INDEX_IG = (handle: string) => `kc:index:social:instagram:${handle}`;

// env
const BASE_URL = process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1';
const TOKEN = process.env.KEYCRM_API_TOKEN || '';
if (!TOKEN) {
  console.warn('[sync] KEYCRM_API_TOKEN is not set');
}

// --- helpers ---
function normHandle(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.replace(/^@+/, '').toLowerCase();
}

type RawCard = any;
type NormalizedCard = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null; // e.g. "@john_doe"
  contact_full_name: string | null;
  updated_at: string; // ISO or "YYYY-MM-DD ..."
};

// normalize KeyCRM card
function normalizeCard(raw: RawCard): NormalizedCard {
  const pipelineId = raw?.status?.pipeline_id ?? raw?.pipeline_id ?? null;
  const statusId = raw?.status_id ?? raw?.status?.id ?? null;
  const socialName = String(raw?.contact?.social_name ?? '').toLowerCase() || null;
  const socialId = raw?.contact?.social_id ?? null;
  const fullName = raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? null;
  return {
    id: Number(raw?.id),
    title: String(raw?.title ?? '').trim(),
    pipeline_id: pipelineId ? Number(pipelineId) : null,
    status_id: statusId ? Number(statusId) : null,
    contact_social_name: socialName,
    contact_social_id: socialId,
    contact_full_name: fullName ?? null,
    updated_at: String(raw?.updated_at ?? raw?.status_changed_at ?? new Date().toISOString()),
  };
}

// generic GET to KeyCRM
async function kcGet(path: string, qs: Record<string, any>) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`KeyCRM ${path} ${res.status}: ${t}`);
  }
  return res.json();
}

// fetch one page of cards limited by pipeline/status (KeyCRM returns {data, next_page_url, ...})
async function fetchCardsPage(
  pipelineId: number,
  statusId: number,
  page: number,
  perPage: number
): Promise<{ items: RawCard[]; hasNext: boolean }> {
  // Adjust to your real endpoint if different
  const json = await kcGet('/pipelines/cards', {
    pipeline_id: pipelineId,
    status_id: statusId,
    page,
    per_page: perPage,
  });

  const data = Array.isArray(json) ? json : json?.data ?? [];
  const hasNext = Boolean((Array.isArray(json) ? null : json?.next_page_url) ?? false);
  return { items: data, hasNext };
}

// 🔧 NEW: includeInactive flag
async function listBasePairs(includeInactive: boolean): Promise<Array<{ pipeline_id: number; status_id: number }>> {
  const ids: string[] = await kvZRange('campaigns:index', 0, -1);
  if (!ids?.length) return [];
  const pairs: Array<{ pipeline_id: number; status_id: number }> = [];
  for (const id of ids) {
    const raw = await kvGet<any>(`campaigns:${id}`);
    if (!raw) continue;
    // запис міг бути збережений у "вільній" формі — читаємо м’яко
    const c: Partial<Campaign> = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const active = Boolean((c as any)?.active);
    if (!includeInactive && !active) continue;

    const p = Number((c as any)?.base_pipeline_id ?? NaN);
    const s = Number((c as any)?.base_status_id ?? NaN);
    if (Number.isFinite(p) && Number.isFinite(s)) {
      pairs.push({ pipeline_id: p, status_id: s });
    }
  }
  // unique pairs
  const uniq = new Map<string, { pipeline_id: number; status_id: number }>();
  for (const p of pairs) uniq.set(`${p.pipeline_id}:${p.status_id}`, p);
  return Array.from(uniq.values());
}

async function indexCard(card: NormalizedCard) {
  // store card
  await kvSet(KC_CARD_KEY(card.id), card);

  // index by pair (only if both present)
  if (card.pipeline_id && card.status_id) {
    const pairKey = KC_INDEX_PAIR(card.pipeline_id, card.status_id);
    await kvZAdd(pairKey, Date.parse(card.updated_at) || Date.now(), String(card.id));
  }

  // index IG handle (by social_id, with and without @)
  const rawHandle = card.contact_social_id ? String(card.contact_social_id) : null;
  const handle = normHandle(rawHandle);
  if (handle) {
    const score = Date.parse(card.updated_at) || Date.now();
    await kvZAdd(KC_INDEX_IG(handle), score, String(card.id));
    await kvZAdd(KC_INDEX_IG(`@${handle}`), score, String(card.id));
  }
}

export async function GET(req: NextRequest) {
  await assertAdmin(req);
  const url = new URL(req.url);

  const perPage = Number(url.searchParams.get('per_page') ?? '50') || 50;
  const maxPages = Number(url.searchParams.get('max_pages') ?? '2') || 2;
  const includeInactive = url.searchParams.get('include_inactive') === '1'; // 🔧 NEW

  const overridePipeline = Number(url.searchParams.get('pipeline_id') ?? '') || undefined;
  const overrideStatus = Number(url.searchParams.get('status_id') ?? '') || undefined;

  let pairs: Array<{ pipeline_id: number; status_id: number }>;
  if (overridePipeline && overrideStatus) {
    pairs = [{ pipeline_id: overridePipeline, status_id: overrideStatus }];
  } else {
    pairs = await listBasePairs(includeInactive); // 🔧 NEW
  }

  const summary: Array<{
    pipeline_id: number;
    status_id: number;
    fetched: number;
    indexed: number;
    pages: number;
  }> = [];

  for (const pair of pairs) {
    let page = 1;
    let fetched = 0;
    let indexed = 0;
    let pages = 0;

    while (page <= maxPages) {
      const { items, hasNext } = await fetchCardsPage(pair.pipeline_id, pair.status_id, page, perPage);
      fetched += items.length;
      pages += 1;

      for (const raw of items) {
        const card = normalizeCard(raw);
        await indexCard(card);
        indexed += 1;
      }

      if (!hasNext) break;
      page += 1;
    }

    summary.push({ pipeline_id: pair.pipeline_id, status_id: pair.status_id, fetched, indexed, pages });
  }

  return NextResponse.json({
    ok: true,
    pairs: pairs.length,
    per_page: perPage,
    max_pages: maxPages,
    include_inactive: includeInactive, // 🔧 NEW
    summary,
  });
}
