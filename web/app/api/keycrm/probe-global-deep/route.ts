// web/app/api/keycrm/probe-global-deep/route.ts
// Глобальний глибинний пошук по contact.social_id (IG хендл) з throttle + retry(429).
// Тепер головний параметр — ?social_id=..., а ?username / ?handle — лише синоніми.

import { NextRequest, NextResponse } from 'next/server';
import { baseUrl, ensureBearer } from '../_common';

export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();
const normHandle = (s?: string | null) =>
  (s ? s.trim().replace(/^@+/, '').toLowerCase() : '');

function token() {
  return ensureBearer(
    process.env.KEYCRM_BEARER ||
      process.env.KEYCRM_API_TOKEN ||
      process.env.KEYCRM_TOKEN ||
      ''
  );
}

async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass') || '';
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if (!expected) return true;
  return bearer === expected || passParam === expected;
}

// fetch з обробкою 429 (retry з експоненційним backoff) + throttle між викликами
async function fetchJsonWithRetry(
  path: string,
  opts: { throttleMs: number; max429Retries: number; initialBackoffMs: number }
) {
  const url = `${baseUrl()}${path}`;
  let attempt = 0;
  let backoff = opts.initialBackoffMs;

  for (;;) {
    if (opts.throttleMs > 0) await sleep(opts.throttleMs);

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

    if (res.status === 429 && attempt < opts.max429Retries) {
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

// список карток (лайт)
async function listCards(
  page: number,
  per_page: number,
  throttleMs: number,
  max429Retries: number,
  initialBackoffMs: number
) {
  const q = new URLSearchParams({ page: String(page), per_page: String(per_page) });
  const json = await fetchJsonWithRetry(`/pipelines/cards?${q.toString()}`, {
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

// деталі картки (тут шукаємо contact.social_id)
async function getCard(
  cardId: number | string,
  throttleMs: number,
  max429Retries: number,
  initialBackoffMs: number
) {
  return await fetchJsonWithRetry(`/pipelines/cards/${cardId}`, {
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
    // головний параметр — social_id; username/handle лишаємо як синоніми
    const socialIdRaw =
      url.searchParams.get('social_id') ||
      url.searchParams.get('username') ||
      url.searchParams.get('handle') ||
      '';
    const socialId = normHandle(socialIdRaw);

    const per_page = Math.min(Math.max(Number(url.searchParams.get('per_page') || '50'), 1), 100) || 50;
    const max_pages = Math.min(Math.max(Number(url.searchParams.get('max_pages') || '20'), 1), 200) || 20;
    const max_card_fetches = Math.min(Math.max(Number(url.searchParams.get('max_card_fetches') || '800'), 1), 3000) || 800;

    const throttle_ms = Math.min(Math.max(Number(url.searchParams.get('delay_ms') || '300'), 0), 2000) || 300;
    const retry_429 = Math.min(Math.max(Number(url.searchParams.get('retry_429') || '6'), 0), 10) || 6;
    const backoff_ms = Math.min(Math.max(Number(url.searchParams.get('backoff_ms') || '700'), 100), 5000) || 700;

    if (!socialId) {
      return NextResponse.json({ ok: false, error: 'social_id is required' }, { status: 400 });
    }

    let page = 1;
    let scannedList = 0;
    let scannedCards = 0;

    let found:
      | null
      | {
          id: number;
          title: string;
          full_name: string | null;
          social_id: string | null;
          pipeline_id: number | null;
          status_id: number | null;
          page: number;
        } = null;

    const samplePairs: Array<{ pipeline_id: number | null; status_id: number | null }> = [];
    const sampleSocial: string[] = [];

    while (page <= max_pages && scannedCards < max_card_fetches && !found) {
      const { ids, hasNext } = await listCards(page, per_page, throttle_ms, retry_429, backoff_ms);
      scannedList += ids.length;

      for (const id of ids) {
        if (scannedCards >= max_card_fetches) break;

        const card = await getCard(id, throttle_ms, retry_429, backoff_ms);
        scannedCards++;

        const pid = card?.status?.pipeline_id ?? card?.pipeline_id ?? null;
        const sid = card?.status_id ?? card?.status?.id ?? null;
        if (samplePairs.length < 12) {
          samplePairs.push({
            pipeline_id: pid ? Number(pid) : null,
            status_id: sid ? Number(sid) : null,
          });
        }

        const socialRaw =
          card?.contact?.social_id ??
          card?.contact?.client?.social_id ??
          null;

        const social = norm(socialRaw);
        if (socialRaw && sampleSocial.length < 12 && !sampleSocial.includes(String(socialRaw))) {
          sampleSocial.push(String(socialRaw));
        }

        if (social === socialId || social === '@' + socialId) {
          found = {
            id: Number(card?.id),
            title: card?.title ?? '',
            full_name: card?.contact?.full_name ?? card?.contact?.client?.full_name ?? null,
            social_id: socialRaw,
            pipeline_id: pid ? Number(pid) : null,
            status_id: sid ? Number(sid) : null,
            page,
          };
          break;
        }
      }

      if (!hasNext || scannedCards >= max_card_fetches || found) break;
      page++;
    }

    return NextResponse.json({
      ok: true,
      found_card_id: found?.id ?? null,
      found,
      stats: {
        pages_scanned: page,
        per_page,
        list_items_seen: scannedList,
        card_details_scanned: scannedCards,
        max_card_fetches,
        max_pages,
      },
      rate_limits: { throttle_ms, retry_429, backoff_ms },
      sample_seen_pairs: samplePairs,
      sample_seen_social_ids: sampleSocial,
      used: { social_id: '@' + socialId }, // для ясності у відповіді
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
