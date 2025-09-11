// app/api/mc/ingest/route.ts
// Приймає JSON з ManyChat: { username, text, full_name?, first_name?, last_name? }
// Шукає картку ТІЛЬКИ в межах базової воронки/статусу активної кампанії з жорсткими лімітами.
// Повертає знайдений card_id (рухати картку можна тут або в іншому місці, за потреби).

import { NextResponse } from 'next/server';
import { kcFindCardIdFast } from '@/lib/keycrm-search';

export const dynamic = 'force-dynamic';

function toNum(v?: string | null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const qs  = url.searchParams;

  // Можна задавати через ENV або через ?pipeline_id=&status_id=&max_pages=
  const pipeline_id = toNum(process.env.MC_LIMIT_PIPELINE_ID ?? qs.get('pipeline_id'));
  const status_id   = toNum(process.env.MC_LIMIT_STATUS_ID   ?? qs.get('status_id'));
  const maxPages    = toNum(process.env.MC_SEARCH_MAX_PAGES  ?? qs.get('max_pages')) ?? 3;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // порожній/невалідний JSON — не критично
  }

  const username   = (body.username ?? '').trim() || undefined;
  const full_name  = (body.full_name ?? body.fullname ?? body.name ?? '').trim();
  const first_name = (body.first_name ?? '').trim();
  const last_name  = (body.last_name ?? '').trim();
  const fullName   = full_name || `${first_name} ${last_name}`.trim();

  if (!username && !fullName) {
    return NextResponse.json({ ok: false, error: 'no_lookup_keys' }, { status: 400 });
  }

  const foundId = await kcFindCardIdFast(
    { username, fullName: fullName || undefined },
    {
      pipeline_id,
      status_id,
      maxPages,
      perPage: 50,
      timeoutMs: 8000, // загальний дедлайн на пошук
    }
  );

  if (!foundId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'card_not_found_scoped',
        debug: { username, fullName: fullName || undefined, pipeline_id, status_id, maxPages },
      },
      { status: 200 }
    );
  }

  // Якщо потрібно — тут можна робити move у цільову воронку/статус.
  // Зараз повертаємо card_id максимально швидко — щоб ManyChat не отримував таймаут.
  return NextResponse.json(
    {
      ok: true,
      card_id: foundId,
      debug: { pipeline_id, status_id, maxPages },
    },
    { status: 200 }
  );
}
