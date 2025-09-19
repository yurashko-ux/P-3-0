// web/app/api/keycrm/card/by-username/route.ts
// Live-пошук card_id у KeyCRM через GET /pipelines/cards за IG username (contact.social_id)
// ⛔️ Без KV. Обмежуємо область пошуку парою pipeline_id + status_id (обов’язково).

import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kcListCards } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if ((expected && bearer === expected) || (expected && passParam === expected)) return true;
  try { await assertAdmin(req); return true; } catch { return false; }
}

const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();
const normHandle = (s?: string | null) => (s ? s.trim().replace(/^@+/, '').toLowerCase() : '');

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized. Use Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const username = normHandle(url.searchParams.get('username') || url.searchParams.get('handle') || '');
    const p = Number(url.searchParams.get('pipeline_id') || '');
    const s = Number(url.searchParams.get('status_id') || '');
    const per_page = Number(url.searchParams.get('per_page') || '50') || 50;
    const max_pages = Number(url.searchParams.get('max_pages') || '2') || 2;

    if (!username) {
      return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
    }
    if (!Number.isFinite(p) || !Number.isFinite(s)) {
      return NextResponse.json({ ok: false, error: 'pipeline_id and status_id are required numbers' }, { status: 400 });
    }

    let page = 1;
    let scanned = 0;
    let foundId: number | null = null;
    const hits: Array<{ id: number; title: string; full_name: string | null; social_id: string | null }> = [];

    while (page <= max_pages) {
      const { items, hasNext } = await kcListCards({
        page,
        per_page,
        pipeline_id: p,
        status_id: s,
      });

      for (const raw of items) {
        const pid = Number(raw?.status?.pipeline_id ?? raw?.pipeline_id);
        const sid = Number(raw?.status_id ?? raw?.status?.id);
        if (pid !== p || sid !== s) continue;

        scanned += 1;

        const social = norm(raw?.contact?.social_id);
        if (social === username || social === '@' + username) {
          foundId = Number(raw?.id);
          hits.push({
            id: foundId,
            title: raw?.title ?? '',
            full_name: raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? null,
            social_id: raw?.contact?.social_id ?? null,
          });
          break;
        }
      }

      if (foundId || !hasNext) break;
      page += 1;
    }

    return NextResponse.json({
      ok: true,
      found_card_id: foundId,
      stats: { scanned, pages_used: page, per_page, max_pages },
      hits,
      used: { username: '@' + username, pipeline_id: p, status_id: s },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
