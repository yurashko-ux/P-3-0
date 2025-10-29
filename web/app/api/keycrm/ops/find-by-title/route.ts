// web/app/api/keycrm/ops/find-by-title/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { baseUrl, ensureBearer } from '../../_common';

export const dynamic = 'force-dynamic';

// ====== Minimal KeyCRM HTTP helpers (без залежності від lib/keycrm) ======
const BASE = baseUrl();
const TOKEN = ensureBearer(
  process.env.KEYCRM_BEARER ||
    process.env.KEYCRM_API_TOKEN ||
    process.env.KEYCRM_TOKEN ||
    ''
);

function mustToken() {
  if (!TOKEN) throw new Error('KEYCRM token is not set (KEYCRM_BEARER / KEYCRM_API_TOKEN / KEYCRM_TOKEN)');
  return TOKEN;
}

async function kcGetJson(path: string, params?: Record<string, any>) {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: mustToken(), 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function listCardsPage(args: {
  page: number;
  per_page?: number;
  pipeline_id?: number;
  status_id?: number;
}) {
  // Swagger: GET /pipelines/cards
  return kcGetJson('/pipelines/cards', args);
}

async function getCard(cardId: number) {
  // Swagger: GET /pipelines/cards/{cardId}
  return kcGetJson(`/pipelines/cards/${cardId}`);
}

// ====== Пошук за full_name у title (кілька варіантів транслітерації/мов) ======
function variantsFromFullName(full: string) {
  const t = (s: string) => s.trim().toLowerCase();
  const base = t(full);
  return [
    `чат з ${base}`,
    `chat with ${base}`,
    base,
  ];
}

// GET /api/keycrm/ops/find-by-title?full_name=...&pipeline_id=1&status_id=38&per_page=50&max_pages=60
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const full_name = (url.searchParams.get('full_name') || '').trim();
    const pipeline_id = url.searchParams.get('pipeline_id') ? Number(url.searchParams.get('pipeline_id')) : undefined;
    const status_id = url.searchParams.get('status_id') ? Number(url.searchParams.get('status_id')) : undefined;
    const per_page = Number(url.searchParams.get('per_page') || 50);
    const max_pages = Number(url.searchParams.get('max_pages') || 60);

    if (!full_name) {
      return NextResponse.json({ ok: false, error: 'full_name is required' }, { status: 400 });
    }

    const variants = variantsFromFullName(full_name);
    let page = 1;
    let pages_used = 0;
    let last_page = 1;
    let scanned = 0;

    let found_id: number | null = null;
    let found_short: any = null;

    while (page <= max_pages) {
      const pageData: any = await listCardsPage({ page, per_page, pipeline_id, status_id }).catch(() => null);
      if (!pageData) break;

      last_page = Number(pageData.last_page ?? last_page);
      const data: any[] = Array.isArray(pageData.data) ? pageData.data : [];

      for (const it of data) {
        scanned++;
        const title = String(it?.title ?? '').toLowerCase();
        if (variants.some(v => title.includes(v))) {
          found_id = Number(it.id);
          found_short = { id: it.id, pipeline_id: it.pipeline_id, status_id: it.status_id, title: it.title };
          break;
        }
      }

      pages_used++;
      if (found_id) break;
      page++;
      if (page > last_page) break;
    }

    // за наявності id підтягнемо повну картку (може знадобитися contact.*)
    let found_full: any = null;
    if (found_id) {
      found_full = await getCard(found_id).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      found_card_id: found_id,
      found: found_full || found_short,
      used: { full_name, variants, pipeline_id, status_id, per_page, max_pages },
      stats: { scanned, pages_used, last_page },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
