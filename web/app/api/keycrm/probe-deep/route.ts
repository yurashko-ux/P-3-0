// web/app/api/keycrm/probe-deep/route.ts
// Глибокий live-пошук у KeyCRM по IG username == contact.social_id
// Перебирає сторінки /pipelines/cards до max_pages. Без KV.

import { NextRequest, NextResponse } from 'next/server';
import { kcListCards } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

// Легка адмін-авторизація: Bearer ADMIN_PASS або ?pass=
async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass') || '';
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
    const pipelineId = Number(url.searchParams.get('pipeline_id') || '');
    const statusId = Number(url.searchParams.get('status_id') || '');
    const per_page = Math.min(Math.max(Number(url.searchParams.get('per_page') || '50'), 1), 100) || 50;
    const max_pages = Math.min(Math.max(Number(url.searchParams.get('max_pages') || '10'), 1), 50) || 10;

    if (!username) {
      return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
    }
    if (!Number.isFinite(pipelineId) || !Number.isFinite(statusId)) {
      return NextResponse.json({ ok: false, error: 'pipeline_id and status_id are required numbers' }, { status: 400 });
    }

    let page = 1;
    let scanned = 0;
    const seenSocial: string[] = [];
    let found: null | {
      id: number; title: string; full_name: string | null; social_id: string | null;
      pipeline_id: number; status_id: number; page: number;
    } = null;

    while (page <= max_pages) {
      const { items, hasNext } = await kcListCards({
        page,
        per_page,
        pipeline_id: pipelineId,
        status_id: statusId,
      });

      for (const it of items) {
        const pid = Number(it?.status?.pipeline_id ?? it?.pipeline_id);
        const sid = Number(it?.status_id ?? it?.status?.id);
        if (pid !== pipelineId || sid !== statusId) continue;

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
            pipeline_id: pid,
            status_id: sid,
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
      used: { username: '@' + username, pipeline_id: pipelineId, status_id: statusId },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
