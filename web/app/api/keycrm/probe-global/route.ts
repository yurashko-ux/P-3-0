// web/app/api/keycrm/probe-global/route.ts
// Глобальний пошук card_id у всій базі KeyCRM по contact.social_id (IG username).
// Не фільтрує за pipeline/status — проходить сторінки /pipelines/cards до max_pages.

import { NextRequest, NextResponse } from 'next/server';
import { kcListCards } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

// Легка адмін-авторизація: Bearer ADMIN_PASS або ?pass=
async function ensureAdmin(req: NextRequest) {
  const u = new URL(req.url);
  const passParam = u.searchParams.get('pass') || '';
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if (!expected) return true;
  return bearer === expected || passParam === expected;
}

const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();
const normHandle = (s?: string | null) =>
  (s ? s.trim().replace(/^@+/, '').toLowerCase() : '');

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const usernameRaw = url.searchParams.get('username') || url.searchParams.get('handle') || '';
    const username = normHandle(usernameRaw);
    const per_page = Math.min(Math.max(Number(url.searchParams.get('per_page') || '100'), 1), 100) || 100;
    const max_pages = Math.min(Math.max(Number(url.searchParams.get('max_pages') || '50'), 1), 200) || 50;

    if (!username) {
      return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
    }

    let page = 1;
    let scanned = 0;
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

    const seenSocial: string[] = [];
    const seenPairs: Array<{ pipeline_id: number | null; status_id: number | null }> = [];

    while (page <= max_pages) {
      const { items, hasNext } = await kcListCards({
        page,
        per_page,
        // ВАЖЛИВО: без pipeline_id/status_id — читаємо все
      });

      for (const it of items) {
        const pid = it?.status?.pipeline_id ?? it?.pipeline_id ?? null;
        const sid = it?.status_id ?? it?.status?.id ?? null;

        // накопичимо кілька пар для діагностики
        if (seenPairs.length < 12) {
          seenPairs.push({
            pipeline_id: pid ? Number(pid) : null,
            status_id: sid ? Number(sid) : null,
          });
        }

        const socialRaw = it?.contact?.social_id ?? null;
        const social = norm(socialRaw);
        if (socialRaw && seenSocial.length < 12 && !seenSocial.includes(String(socialRaw))) {
          seenSocial.push(String(socialRaw));
        }

        scanned++;
        if (social === username || social === '@' + username) {
          found = {
            id: Number(it?.id),
            title: it?.title ?? '',
            full_name: it?.contact?.full_name ?? it?.contact?.client?.full_name ?? null,
            social_id: socialRaw,
            pipeline_id: pid ? Number(pid) : null,
            status_id: sid ? Number(sid) : null,
            page,
          };
          break;
        }
      }

      if (found || !hasNext) break;
      page++;
    }

    return NextResponse.json({
      ok: true,
      found_card_id: found?.id ?? null,
      found,
      stats: { scanned, pages_used: page, per_page, max_pages },
      sample_seen_social_ids: seenSocial,
      sample_seen_pairs: seenPairs,
      used: { username: '@' + username },
      tip: 'Якщо не знайшло — збільши ?max_pages (до 200) або перевір, що social_id у KeyCRM збігається з IG username.',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
