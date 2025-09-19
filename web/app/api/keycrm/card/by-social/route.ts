// web/app/api/keycrm/card/by-social/route.ts
// Повертає card_id за contact.social_id у КОНКРЕТНІЙ парі (pipeline_id + status_id).
// Стратегія: лістимо /pipelines/cards з фільтрами, для кожного id тягнемо деталі /pipelines/cards/{id},
// звіряємо contact.social_id. Оптимізовано під надійність (throttle + retry 429).

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();
const normHandle = (s?: string | null) => (s ? s.trim().replace(/^@+/, '').toLowerCase() : '');

function baseUrl() {
  return process.env.KEYCRM_API_URL || process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1';
}
function token() {
  return (
    process.env.KEYCRM_API_TOKEN ||
    process.env.KEYCRM_BEARER ||
    process.env.KEYCRM_TOKEN ||
    ''
  );
}

// Дозволяємо Bearer ADMIN_PASS або ?pass=
async function ensureAdmin(req: NextRequest) {
  const u = new URL(req.url);
  const pass = u.searchParams.get('pass') || '';
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if (!expected) return true;
  return bearer === expected || pass === expected;
}

// fetch з throttle + retry(429)
async function fetchJsonWithRetry(
  path: string,
  { throttleMs, max429Retries, initialBackoffMs }: { throttleMs: number; max429Retries: number; initialBackoffMs: number }
) {
  const url = `${baseUrl()}${path}`;
  let attempt = 0;
  let backoff = initialBackoffMs;

  for (;;) {
    if (throttleMs > 0) await sleep(throttleMs);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    if (res.ok) {
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { throw new Error(`KeyCRM returned non-JSON at ${url} :: ${text.slice(0, 400)}`); }
    }

    if (res.status === 429 && attempt < max429Retries) {
      attempt++;
      const ra = Number(res.headers.get('retry-after') || '') || 0;
      const wait = Math.max(backoff, ra * 1000);
      await sleep(wait);
      backoff = Math.min(backoff * 2, 15000);
      continue;
    }

    const text = await res.text().catch(() => '');
    throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  }
}

// 1) список карток у межах пари
async function listPairCards(
  page: number,
  per_page: number,
  pipeline_id: number,
  status_id: number,
  throttleMs: number,
  max429Retries: number,
  initialBackoffMs: number
) {
  const qs = new URLSearchParams({
    page: String(page),
    per_page: String(per_page),
    pipeline_id: String(pipeline_id),
    status_id: String(status_id),
  });
  const json = await fetchJsonWithRetry(`/pipelines/cards?${qs.toString()}`, {
    throttleMs,
    max429Retries,
    initialBackoffMs,
  });

  if (Array.isArray(json)) {
    return { ids: json.map((x: any) => x?.id).filter(Boolean), hasNext: json.length === per_page };
  }
  const items = Array.isArray(json?.data) ? json.data : [];
  const ids = items.map((x: any) => x?.id).filter(Boolean);
  const current = Number(json?.current_page ?? page);
  const last = Number(json?.last_page ?? current);
  const nextUrl = json?.next_page_url ?? null;
  return { ids, hasNext: !!nextUrl || current < last };
}

// 2) деталі однієї картки
async function getCard(
  id: number | string,
  throttleMs: number,
  max429Retries: number,
  initialBackoffMs: number
) {
  return await fetchJsonWithRetry(`/pipelines/cards/${id}`, {
    throttleMs,
    max429Retries,
    initialBackoffMs,
  });
}

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const socialRaw =
      url.searchParams.get('social_id') ||
      url.searchParams.get('username') ||
      url.searchParams.get('handle') ||
      '';
    const socialNeedle = normHandle(socialRaw);

    const pipeline_id = Number(url.searchParams.get('pipeline_id') || '');
    const status_id = Number(url.searchParams.get('status_id') || '');
    const per_page = Math.min(Math.max(Number(url.searchParams.get('per_page') || '50'), 1), 100);
    const max_pages = Math.min(Math.max(Number(url.searchParams.get('max_pages') || '20'), 1), 200);

    // контроль лімітів (щоб не впертись у 429)
    const delay_ms = Math.min(Math.max(Number(url.searchParams.get('delay_ms') || '250'), 0), 2000);
    const retry_429 = Math.min(Math.max(Number(url.searchParams.get('retry_429') || '6'), 0), 10);
    const backoff_ms = Math.min(Math.max(Number(url.searchParams.get('backoff_ms') || '600'), 100), 5000);

    if (!socialNeedle) {
      return NextResponse.json({ ok: false, error: 'social_id is required' }, { status: 400 });
    }
    if (!Number.isFinite(pipeline_id) || !Number.isFinite(status_id)) {
      return NextResponse.json({ ok: false, error: 'pipeline_id and status_id must be numbers' }, { status: 400 });
    }

    let page = 1;
    let listSeen = 0;
    let detailsSeen = 0;

    let found: null | {
      id: number;
      title: string;
      full_name: string | null;
      social_id: string | null;
      pipeline_id: number | null;
      status_id: number | null;
      page: number;
    } = null;

    while (page <= max_pages && !found) {
      const { ids, hasNext } = await listPairCards(
        page, per_page, pipeline_id, status_id,
        delay_ms, retry_429, backoff_ms
      );
      listSeen += ids.length;

      for (const id of ids) {
        const card = await getCard(id, delay_ms, retry_429, backoff_ms);
        detailsSeen++;

        const socialRawCard =
          card?.contact?.social_id ??
          card?.contact?.client?.social_id ??
          null;

        const social = norm(socialRawCard);
        if (social === socialNeedle || social === '@' + socialNeedle) {
          const pid = card?.status?.pipeline_id ?? card?.pipeline_id ?? null;
          const sid = card?.status_id ?? card?.status?.id ?? null;
          found = {
            id: Number(card?.id),
            title: card?.title ?? '',
            full_name: card?.contact?.full_name ?? card?.contact?.client?.full_name ?? null,
            social_id: socialRawCard,
            pipeline_id: pid ? Number(pid) : null,
            status_id: sid ? Number(sid) : null,
            page,
          };
          break;
        }
      }

      if (!hasNext || found) break;
      page++;
    }

    return NextResponse.json({
      ok: true,
      card_id: found?.id ?? null,
      found,
      stats: {
        pipeline_id, status_id,
        pages_scanned: page,
        per_page,
        list_items_seen: listSeen,
        card_details_scanned: detailsSeen,
      },
      used: { social_id: '@' + socialNeedle },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
