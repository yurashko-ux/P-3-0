// web/app/api/keycrm/probe-pair-deep/route.ts
// Глибинний пошук у КОНКРЕТНІЙ парі (pipeline_id + status_id) по contact.social_id.
// 1) Лістимо /pipelines/cards з фільтрами pipeline_id/status_id
// 2) Для кожної картки тягнемо деталі /pipelines/cards/{id} і перевіряємо contact.social_id
// Має допомогти отримати card_id для social_id=kolachnyk.v у парі (1, 38).

import { NextRequest, NextResponse } from 'next/server';
import { baseUrl, ensureBearer } from '../../_common';

export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();
const normHandle = (s?: string | null) => (s ? s.trim().replace(/^@+/, '').toLowerCase() : '');

function token() {
  return ensureBearer(
    process.env.KEYCRM_BEARER ||
      process.env.KEYCRM_API_TOKEN ||
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

    const auth = token();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = auth;
    const res = await fetch(url, {
      headers,
      cache: 'no-store',
    });

    if (res.ok) {
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { throw new Error(`KeyCRM returned non-JSON at ${url} :: ${text.slice(0, 400)}`); }
    }

    if (res.status === 429 && attempt < max429Retries) {
      attempt++;
      const retryAfter = Number(res.headers.get('retry-after') || '') || 0;
      const wait = Math.max(backoff, retryAfter * 1000);
      await sleep(wait);
      backoff = Math.min(backoff * 2, 15000);
      continue;
    }

    const text = await res.text().catch(() => '');
    throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  }
}

// 1) список карток в межах ПАРИ
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

// 2) деталі однієї картки (для читання contact.social_id)
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

    const pipeline_id = Number(url.searchParams.get('pipeline_id') || '1'); // за замовчуванням 1
    const status_id = Number(url.searchParams.get('status_id') || '38');    // за замовчуванням 38
    const per_page = Math.min(Math.max(Number(url.searchParams.get('per_page') || '50'), 1), 100);
    const max_pages = Math.min(Math.max(Number(url.searchParams.get('max_pages') || '20'), 1), 200);
    const max_card_fetches = Math.min(Math.max(Number(url.searchParams.get('max_card_fetches') || '1000'), 1), 5000);

    // контроль лімітів
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
    let cardSeen = 0;

    let found: null | {
      id: number;
      title: string;
      full_name: string | null;
      social_id: string | null;
      pipeline_id: number | null;
      status_id: number | null;
      page: number;
    } = null;

    const sampleSocial: string[] = [];

    while (page <= max_pages && cardSeen < max_card_fetches && !found) {
      const { ids, hasNext } = await listPairCards(
        page, per_page, pipeline_id, status_id,
        delay_ms, retry_429, backoff_ms
      );
      listSeen += ids.length;

      for (const id of ids) {
        if (cardSeen >= max_card_fetches) break;

        const card = await getCard(id, delay_ms, retry_429, backoff_ms);
        cardSeen++;

        const socialRawCard =
          card?.contact?.social_id ??
          card?.contact?.client?.social_id ??
          null;

        if (socialRawCard && sampleSocial.length < 12 && !sampleSocial.includes(String(socialRawCard))) {
          sampleSocial.push(String(socialRawCard));
        }

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

      if (!hasNext || cardSeen >= max_card_fetches || found) break;
      page++;
    }

    return NextResponse.json({
      ok: true,
      found_card_id: found?.id ?? null,
      found,
      stats: {
        pipeline_id, status_id,
        pages_scanned: page,
        per_page,
        list_items_seen: listSeen,
        card_details_scanned: cardSeen,
        max_card_fetches,
      },
      rate_limits: { delay_ms, retry_429, backoff_ms },
      sample_seen_social_ids: sampleSocial,
      used: { social_id: '@' + socialNeedle },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
