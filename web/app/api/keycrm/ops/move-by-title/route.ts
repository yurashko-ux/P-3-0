// web/app/api/keycrm/ops/move-by-title/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { baseUrl, ensureBearer } from '../../_common';

export const dynamic = 'force-dynamic';

const BASE = baseUrl();
const TOKEN = ensureBearer(
  process.env.KEYCRM_BEARER ||
    process.env.KEYCRM_API_TOKEN ||
    process.env.KEYCRM_TOKEN ||
    ''
);

function mustToken() {
  if (!TOKEN) throw new Error('KEYCRM token missing (KEYCRM_BEARER / KEYCRM_API_TOKEN / KEYCRM_TOKEN)');
  return TOKEN!;
}

async function kcFetch(path: string, opts?: RequestInit & { query?: Record<string, any> }) {
  const url = new URL(`${BASE}${path}`);
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    ...opts,
    headers: {
      Authorization: mustToken(),
      'Content-Type': 'application/json',
      ...(opts?.headers || {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

function titleVariants(full: string) {
  const s = full.trim().toLowerCase();
  return [`чат з ${s}`, `chat with ${s}`, s];
}

async function listCardsPage(args: { page: number; per_page?: number; pipeline_id?: number; status_id?: number; }) {
  return kcFetch('/pipelines/cards', { query: args });
}

async function getCard(cardId: number) {
  return kcFetch(`/pipelines/cards/${cardId}`);
}

async function updateCard(cardId: number, body: any) {
  // Swagger: PUT /pipelines/cards/{cardId}
  return kcFetch(`/pipelines/cards/${cardId}`, { method: 'PUT', body: JSON.stringify(body) });
}

// GET /api/keycrm/ops/move-by-title?full_name=...&to_pipeline_id=1&to_status_id=38
// опційно звузити пошук: &search_pipeline_id=1&search_status_id=38&per_page=50&max_pages=60
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const full_name = (url.searchParams.get('full_name') || '').trim();
    if (!full_name) return NextResponse.json({ ok: false, error: 'full_name is required' }, { status: 400 });

    const search_pipeline_id = url.searchParams.get('search_pipeline_id') ? Number(url.searchParams.get('search_pipeline_id')) : undefined;
    const search_status_id   = url.searchParams.get('search_status_id') ? Number(url.searchParams.get('search_status_id')) : undefined;

    const to_pipeline_id = url.searchParams.get('to_pipeline_id') ? Number(url.searchParams.get('to_pipeline_id')) : undefined;
    const to_status_id   = url.searchParams.get('to_status_id') ? Number(url.searchParams.get('to_status_id')) : undefined;
    if (!to_pipeline_id || !to_status_id) {
      return NextResponse.json({ ok: false, error: 'to_pipeline_id and to_status_id are required' }, { status: 400 });
    }

    const per_page = Number(url.searchParams.get('per_page') || 50);
    const max_pages = Number(url.searchParams.get('max_pages') || 60);

    // 1) Знайти card_id по title
    const variants = titleVariants(full_name);
    let page = 1, pages_used = 0, last_page = 1, scanned = 0;
    let found_id: number | null = null;
    let found_short: any = null;

    while (page <= max_pages) {
      const pageData: any = await listCardsPage({
        page, per_page,
        pipeline_id: search_pipeline_id,
        status_id:   search_status_id,
      }).catch(() => null);
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

    if (!found_id) {
      return NextResponse.json({
        ok: false,
        error: 'card not found by title',
        used: { full_name, variants, search_pipeline_id, search_status_id, per_page, max_pages },
        stats: { scanned, pages_used, last_page },
      }, { status: 404 });
    }

    // 2) Перемістити
    const before = await getCard(found_id).catch(() => null);
    const updated = await updateCard(found_id, {
      pipeline_id: to_pipeline_id,
      status_id: to_status_id,
    }).catch((e: any) => ({ error: String(e?.message || e) }));

    return NextResponse.json({
      ok: !('error' in (updated || {})),
      card_id: found_id,
      move: { to_pipeline_id, to_status_id },
      before,
      after: updated,
      used: { full_name, variants, search_pipeline_id, search_status_id, per_page, max_pages },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
