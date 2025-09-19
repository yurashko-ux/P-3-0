ф// web/app/api/keycrm/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import type { Campaign } from '@/lib/types';

const KC_CARD_KEY = (id: number | string) => `kc:card:${id}`;
const KC_INDEX_PAIR = (p: number, s: number) => `kc:index:cards:${p}:${s}`;
const KC_INDEX_IG = (handle: string) => `kc:index:social:instagram:${handle}`;

const BASE_URL = process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1';
const TOKEN = process.env.KEYCRM_API_TOKEN || '';

/* ----------------------- auth: Bearer або ?pass= ----------------------- */
async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  const ok =
    (expected && bearer && bearer === expected) ||
    (expected && passParam && passParam === expected);
  if (ok) return true;
  try { await assertAdmin(req); return true; } catch { return false; }
}

/* ------------------------------ utils --------------------------------- */
function normHandle(s?: string | null) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.replace(/^@+/, '').toLowerCase();
}
function normalizeApiPath(p?: string | null): string {
  // важливо: без початкового '/', інакше "з'їсть" /v1
  if (!p) return 'leads'; // дефолт тепер — leads
  return String(p).replace(/^\/+/, '') || 'leads';
}

type RawCard = any;
type NormalizedCard = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null;
  contact_social_id: string | null;
  contact_full_name: string | null;
  updated_at: string;
};

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

async function kcGet(path: string, qs: Record<string, any>) {
  if (!TOKEN) throw new Error('KEYCRM_API_TOKEN is not set');
  const url = new URL(normalizeApiPath(path), BASE_URL);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { throw new Error(`KeyCRM returned non-JSON at ${url} :: ${text.slice(0, 400)}`); }
}

/**
 * Витягуємо сторінку з KeyCRM.
 * За замовчуванням path='leads'.
 * Якщо сервер не фільтрує pipeline_id/status_id — відфільтруємо клієнтськи нижче.
 */
async function fetchCardsPage(
  pipelineId: number,
  statusId: number,
  page: number,
  perPage: number,
  pathOverride?: string
): Promise<{ items: RawCard[]; hasNext: boolean; raw?: any }> {
  const path = normalizeApiPath(pathOverride);
  const json = await kcGet(path, {
    // багато інсталяцій KeyCRM НЕ підтримують ці query — ок, ми все одно надішлемо
    pipeline_id: pipelineId,
    status_id: statusId,
    page,
    per_page: perPage,
  });

  const data = Array.isArray(json) ? json : (json?.data ?? []);
  const hasNext = Boolean((Array.isArray(json) ? null : json?.next_page_url) ?? false);
  return { items: data, hasNext, raw: json };
}

async function listBasePairs(includeInactive: boolean) {
  const ids: string[] = await kvZRange('campaigns:index', 0, -1);
  if (!ids?.length) return [];
  const pairs: Array<{ pipeline_id: number; status_id: number }> = [];
  for (const id of ids) {
    const raw = await kvGet<any>(`campaigns:${id}`);
    if (!raw) continue;
    const c: Partial<Campaign> = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const active = Boolean((c as any)?.active);
    if (!includeInactive && !active) continue;
    const p = Number((c as any)?.base_pipeline_id ?? NaN);
    const s = Number((c as any)?.base_status_id ?? NaN);
    if (Number.isFinite(p) && Number.isFinite(s)) pairs.push({ pipeline_id: p, status_id: s });
  }
  // uniq
  const uniq = new Map<string, { pipeline_id: number; status_id: number }>();
  for (const p of pairs) uniq.set(`${p.pipeline_id}:${p.status_id}`, p);
  return Array.from(uniq.values());
}

async function indexCard(card: NormalizedCard) {
  await kvSet(KC_CARD_KEY(card.id), card);
  const score = Date.parse(card.updated_at) || Date.now();
  if (card.pipeline_id && card.status_id) {
    await kvZAdd(KC_INDEX_PAIR(card.pipeline_id, card.status_id), score, String(card.id));
  }
  const handle = normHandle(card.contact_social_id);
  if (handle) {
    await kvZAdd(KC_INDEX_IG(handle), score, String(card.id));
    await kvZAdd(KC_INDEX_IG(`@${handle}`), score, String(card.id));
  }
}

/* --------------------------------- GET -------------------------------- */
export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized. Use Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const perPage = Number(url.searchParams.get('per_page') ?? '50') || 50;
    const maxPages = Number(url.searchParams.get('max_pages') ?? '2') || 2;
    const includeInactive = url.searchParams.get('include_inactive') === '1';
    const pathOverride = url.searchParams.get('path') || undefined; // тепер за замовчуванням 'leads'

    const overridePipeline = Number(url.searchParams.get('pipeline_id') ?? '') || undefined;
    const overrideStatus = Number(url.searchParams.get('status_id') ?? '') || undefined;

    let pairs: Array<{ pipeline_id: number; status_id: number }>;
    if (overridePipeline && overrideStatus) {
      pairs = [{ pipeline_id: overridePipeline, status_id: overrideStatus }];
    } else {
      pairs = await listBasePairs(includeInactive);
    }

    const summary: Array<{ pipeline_id: number; status_id: number; fetched: number; indexed: number; pages: number }> = [];

    for (const pair of pairs) {
      let page = 1, fetched = 0, indexed = 0, pages = 0;

      while (page <= maxPages) {
        const { items, hasNext } = await fetchCardsPage(pair.pipeline_id, pair.status_id, page, perPage, pathOverride);
        pages += 1;

        // клієнтська фільтрація за pipeline/status на випадок, якщо API не фільтрує
        const filtered = items.filter((raw: any) => {
          const p = raw?.status?.pipeline_id ?? raw?.pipeline_id;
          const s = raw?.status_id ?? raw?.status?.id;
          return Number(p) === pair.pipeline_id && Number(s) === pair.status_id;
        });

        fetched += filtered.length;

        for (const raw of filtered) {
          await indexCard(normalizeCard(raw));
          indexed += 1;
        }

        if (!hasNext) break;
        page += 1;
      }

      summary.push({ pipeline_id: pair.pipeline_id, status_id: pair.status_id, fetched, indexed, pages });
    }

    return NextResponse.json({
      ok: true,
      base_url: BASE_URL,
      path: normalizeApiPath(pathOverride), // 'leads' by default
      include_inactive: includeInactive,
      pairs: pairs.length,
      selected_pairs: pairs,
      per_page: perPage,
      max_pages: maxPages,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || String(e),
        hint: "Спробуй без параметра або ?path=leads. Якщо у вас інший ресурс — передай ?path=<resource> (без початкового '/').",
        env: { has_TOKEN: Boolean(TOKEN), BASE_URL },
      },
      { status: 400 }
    );
  }
}
// web/app/api/keycrm/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign } from '@/lib/types';

const KC_CARD_KEY = (id: number | string) => `kc:card:${id}`;
const KC_INDEX_PAIR = (p: number, s: number) => `kc:index:cards:${p}:${s}`;
const KC_INDEX_IG = (handle: string) => `kc:index:social:instagram:${handle}`;

const BASE_URL = process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1';
const TOKEN = process.env.KEYCRM_API_TOKEN || '';

// ---- auth helpers (Bearer або ?pass=...) ----
async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  const ok =
    (expected && bearer && bearer === expected) ||
    (expected && passParam && passParam === expected);
  if (ok) return true;
  try { await assertAdmin(req); return true; } catch { return false; }
}

// ---- utils ----
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
  contact_social_id: string | null;
  contact_full_name: string | null;
  updated_at: string;
};

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

// гнучкий GET до KeyCRM з безпечною обробкою
async function kcGet(path: string, qs: Record<string, any>) {
  if (!TOKEN) throw new Error('KEYCRM_API_TOKEN is not set');
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // повертаємо максимум інформації для дебагу
    throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url.toString()} :: ${text.slice(0, 400)}`);
  }
  try { return JSON.parse(text); } catch {
    // KeyCRM повернув не-JSON
    throw new Error(`KeyCRM returned non-JSON at ${url.toString()} :: ${text.slice(0, 400)}`);
  }
}

async function fetchCardsPage(
  pipelineId: number,
  statusId: number,
  page: number,
  perPage: number,
  pathOverride?: string
): Promise<{ items: RawCard[]; hasNext: boolean; raw?: any }> {
  // якщо реальний ендпоінт відрізняється — можна передати ?path=/your/endpoint
  const path = pathOverride || '/pipelines/cards';
  const json = await kcGet(path, {
    pipeline_id: pipelineId,
    status_id: statusId,
    page,
    per_page: perPage,
  });

  // підтримка як масиву, так і пагінованого відповіді {data, next_page_url,...}
  const data = Array.isArray(json) ? json : (json?.data ?? []);
  const hasNext = Boolean((Array.isArray(json) ? null : json?.next_page_url) ?? false);
  return { items: data, hasNext, raw: json };
}

async function listBasePairs(includeInactive: boolean): Promise<Array<{ pipeline_id: number; status_id: number }>> {
  const ids: string[] = await kvZRange('campaigns:index', 0, -1);
  if (!ids?.length) return [];
  const pairs: Array<{ pipeline_id: number; status_id: number }> = [];
  for (const id of ids) {
    const raw = await kvGet<any>(`campaigns:${id}`);
    if (!raw) continue;
    const c: Partial<Campaign> = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const active = Boolean((c as any)?.active);
    if (!includeInactive && !active) continue;
    const p = Number((c as any)?.base_pipeline_id ?? NaN);
    const s = Number((c as any)?.base_status_id ?? NaN);
    if (Number.isFinite(p) && Number.isFinite(s)) {
      pairs.push({ pipeline_id: p, status_id: s });
    }
  }
  const uniq = new Map<string, { pipeline_id: number; status_id: number }>();
  for (const p of pairs) uniq.set(`${p.pipeline_id}:${p.status_id}`, p);
  return Array.from(uniq.values());
}

async function indexCard(card: NormalizedCard) {
  await kvSet(KC_CARD_KEY(card.id), card);
  const score = Date.parse(card.updated_at) || Date.now();
  if (card.pipeline_id && card.status_id) {
    await kvZAdd(KC_INDEX_PAIR(card.pipeline_id, card.status_id), score, String(card.id));
  }
  const handle = normHandle(card.contact_social_id || undefined);
  if (handle) {
    await kvZAdd(KC_INDEX_IG(handle), score, String(card.id));
    await kvZAdd(KC_INDEX_IG(`@${handle}`), score, String(card.id));
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized. Use Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const perPage = Number(url.searchParams.get('per_page') ?? '50') || 50;
    const maxPages = Number(url.searchParams.get('max_pages') ?? '2') || 2;
    const includeInactive = url.searchParams.get('include_inactive') === '1';
    const pathOverride = url.searchParams.get('path') || undefined; // діагностичний параметр

    const overridePipeline = Number(url.searchParams.get('pipeline_id') ?? '') || undefined;
    const overrideStatus = Number(url.searchParams.get('status_id') ?? '') || undefined;

    let pairs: Array<{ pipeline_id: number; status_id: number }>;
    if (overridePipeline && overrideStatus) {
      pairs = [{ pipeline_id: overridePipeline, status_id: overrideStatus }];
    } else {
      pairs = await listBasePairs(includeInactive);
    }

    const summary: Array<{ pipeline_id: number; status_id: number; fetched: number; indexed: number; pages: number }> = [];

    for (const pair of pairs) {
      let page = 1, fetched = 0, indexed = 0, pages = 0;

      while (page <= maxPages) {
        const { items, hasNext } = await fetchCardsPage(pair.pipeline_id, pair.status_id, page, perPage, pathOverride);
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
      include_inactive: includeInactive,
      selected_pairs: pairs,
      base_url: BASE_URL,
      summary,
    });
  } catch (e: any) {
    // 🔴 головне — не 500, а прозорий JSON
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || String(e),
        hint: 'Спробуй додати ?path=/deals або ?path=/pipelines/cards — залежно від реального ендпоінта KeyCRM.',
        env: {
          has_TOKEN: Boolean(TOKEN),
          BASE_URL,
        },
      },
      { status: 400 }
    );
  }
}
