// web/app/api/keycrm/probe-global-deep/route.ts
// Глобальний глибинний пошук card_id по contact.social_id (IG username)
// 1) пагінуємо /pipelines/cards
// 2) для кожного id робимо GET /pipelines/cards/{id} і звіряємо contact.social_id

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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

async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass') || '';
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if (!expected) return true;
  return bearer === expected || passParam === expected;
}

async function fetchJson(path: string) {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`KeyCRM ${res.status} ${res.statusText} at ${url} :: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`KeyCRM returned non-JSON at ${url} :: ${text.slice(0, 400)}`);
  }
}

// список карток (лайт)
async function listCards(page: number, per_page: number) {
  const q = new URLSearchParams({ page: String(page), per_page: String(per_page) });
  const json = await fetchJson(`/pipelines/cards?${q.toString()}`);
  // Laravel-style або простий масив
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

// деталі однієї картки (тут має бути contact.social_id)
async function getCard(cardId: number | string) {
  const json = await fetchJson(`/pipelines/cards/${cardId}`);
  return json;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const usernameRaw = url.searchParams.get('username') || url.searchParams.get('handle') || '';
    const username = normHandle(usernameRaw);
    const per_page = Math.min(Math.max(Number(url.searchParams.get('per_page') || '50'), 1), 100) || 50;
    const max_pages = Math.min(Math.max(Number(url.searchParams.get('max_pages') || '20'), 1), 200) || 20;
    const max_card_fetches = Math.min(Math.max(Number(url.searchParams.get('max_card_fetches') || '1000'), 1), 5000) || 1000;

    if (!username) {
      return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
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

    // пагінуємо список
    while (page <= max_pages && scannedCards < max_card_fetches && !found) {
      const { ids, hasNext } = await listCards(page, per_page);
      scannedList += ids.length;

      // для кожного id — тягнемо деталі
      for (const id of ids) {
        if (scannedCards >= max_card_fetches) break;
        const card = await getCard(id);
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

        if (social === username || social === '@' + username) {
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
      sample_seen_pairs: samplePairs,
      sample_seen_social_ids: sampleSocial,
      used: { username: '@' + username },
      note:
        'Цей пробник додатково запитує деталі кожної картки. Якщо не знайшло — або social_id відрізняється від IG, або контакт не з Instagram, або API не повертає social_id для вашого тарифу/джерела.',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
