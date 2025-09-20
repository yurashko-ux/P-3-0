// web/app/api/keycrm/ops/find-by-title/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kcListCardsLaravel, kcGetCard } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

function variantsFromFullName(full: string) {
  const t = (s: string) => s.toLowerCase().trim();
  const base = t(full);
  return [
    `чат з ${base}`,
    `chat with ${base}`,
    base,
  ];
}

/**
 * GET /api/keycrm/ops/find-by-title?full_name=...&pipeline_id=1&status_id=38&per_page=50&max_pages=60
 * Повертає { ok, found_card_id, found, used, stats }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const full_name = (url.searchParams.get('full_name') || '').trim();
  const pipeline_id = Number(url.searchParams.get('pipeline_id') || 0) || undefined;
  const status_id = Number(url.searchParams.get('status_id') || 0) || undefined;
  const per_page = Number(url.searchParams.get('per_page') || 50);
  const max_pages = Number(url.searchParams.get('max_pages') || 60);

  if (!full_name) {
    return NextResponse.json({ ok: false, error: 'full_name is required' }, { status: 400 });
  }

  const nameVariants = variantsFromFullName(full_name);

  let page = 1;
  let found: any = null;
  let found_id: number | null = null;
  let pages_used = 0;
  let scanned = 0;
  let last_page = 1;

  while (page <= max_pages) {
    const list = await kcListCardsLaravel({ page, per_page, pipeline_id, status_id }).catch(() => null);
    if (!list) break;

    last_page = Number(list.last_page ?? last_page);
    const data: any[] = Array.isArray(list.data) ? list.data : [];
    for (const it of data) {
      scanned++;
      const title = String(it?.title ?? '').toLowerCase();
      if (nameVariants.some(v => title.includes(v))) {
        const full = await kcGetCard(Number(it.id)).catch(() => null);
        found = full?.id ? full : { id: it.id, pipeline_id: it.pipeline_id, status_id: it.status_id, title: it.title };
        found_id = Number(it.id);
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
    found: found || null,
    used: { full_name, variants: nameVariants, pipeline_id, status_id, per_page, max_pages },
    stats: { scanned, pages_used, last_page }
  });
}
