// web/app/api/campaigns/apply/find-by-fullname/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const KEYCRM_BASE = process.env.KEYCRM_API_URL?.replace(/\/+$/, '') || 'https://openapi.keycrm.app/v1';
const KEYCRM_TOKEN = process.env.KEYCRM_BEARER || process.env.KEYCRM_API_TOKEN;

function mustToken() {
  if (!KEYCRM_TOKEN) throw new Error('KEYCRM token missing (KEYCRM_BEARER або KEYCRM_API_TOKEN)');
  return KEYCRM_TOKEN!;
}

async function kcFetch(path: string, query?: Record<string, any>) {
  const url = new URL(`${KEYCRM_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${mustToken()}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return text; }
}

function titleVariants(full: string) {
  const s = full.trim().toLowerCase();
  return [`чат з ${s}`, `chat with ${s}`, s];
}

type Campaign = {
  id: string;
  name: string;
  base_pipeline_id: number;
  base_status_id: number;
  rules?: {
    v1: { op: 'contains' | 'equals'; value: string };
    v2?: { op: 'contains' | 'equals'; value: string };
  };
};

async function listCardsPage(args: { page: number; per_page: number; pipeline_id: number; status_id: number; }) {
  return kcFetch('/pipelines/cards', args);
}

// GET /api/campaigns/apply/find-by-fullname?campaign_id=...&full_name=...&per_page=50&max_pages=60
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const campaign_id = url.searchParams.get('campaign_id') || '';
    const full_name = (url.searchParams.get('full_name') || '').trim();
    const per_page = Math.min(Number(url.searchParams.get('per_page') || 50), 100);
    const max_pages = Math.min(Number(url.searchParams.get('max_pages') || 60), 200);

    if (!campaign_id) return NextResponse.json({ ok: false, error: 'campaign_id is required' }, { status: 400 });
    if (!full_name)   return NextResponse.json({ ok: false, error: 'full_name is required' }, { status: 400 });

    // 1) Дістаємо кампанію з KV
    const raw = await kvGet<any>(`campaigns:${campaign_id}`);
    if (!raw) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
    const c: Campaign = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const pipeline_id = Number(c.base_pipeline_id);
    const status_id   = Number(c.base_status_id);
    if (!pipeline_id || !status_id) {
      return NextResponse.json({ ok: false, error: 'campaign has no base_pipeline_id/base_status_id' }, { status: 400 });
    }

    // 2) Пошук по title у межах базової пари
    const variants = titleVariants(full_name);
    let page = 1, pages_used = 0, last_page = 1, scanned = 0;
    let found_id: number | null = null;
    let found_short: any = null;

    while (page <= max_pages) {
      const list: any = await listCardsPage({ page, per_page, pipeline_id, status_id }).catch(() => null);
      if (!list) break;

      last_page = Number(list.last_page ?? last_page);
      const data: any[] = Array.isArray(list.data) ? list.data : [];

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

    return NextResponse.json({
      ok: true,
      found_card_id: found_id,
      found: found_short,
      campaign: {
        id: c.id,
        name: c.name,
        base_pipeline_id: pipeline_id,
        base_status_id: status_id,
        rules: {
          v1: c.rules?.v1 || null,
          v2: c.rules?.v2 || { op: 'contains', value: '' },
        },
      },
      used: { full_name, variants, per_page, max_pages },
      stats: { scanned, pages_used, last_page },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
