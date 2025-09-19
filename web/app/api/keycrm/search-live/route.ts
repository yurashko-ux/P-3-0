// web/app/api/keycrm/search-live/route.ts
// Live-пошук card_id у KeyCRM через GET /pipelines/cards

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
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const username = normHandle(url.searchParams.get('username') || url.searchParams.get('handle'));
    const fullname = norm(url.searchParams.get('fullname') || url.searchParams.get('name'));
    const pipelineId = Number(url.searchParams.get('pipeline_id') || '');
    const statusId = Number(url.searchParams.get('status_id') || '');
    const per_page = Number(url.searchParams.get('per_page') || '50') || 50;
    const max_pages = Number(url.searchParams.get('max_pages') || '2') || 2;

    if (!Number.isFinite(pipelineId) || !Number.isFinite(statusId)) {
      return NextResponse.json({ ok: false, error: 'pipeline_id and status_id are required numbers' }, { status: 400 });
    }

    let page = 1;
    let found: number | null = null;
    let scanned = 0;
    const hits: any[] = [];

    while (page <= max_pages) {
      const { items, hasNext } = await kcListCards({ page, per_page, pipeline_id: pipelineId, status_id: statusId });

      for (const raw of items) {
        const pid = Number(raw?.status?.pipeline_id ?? raw?.pipeline_id);
        const sid = Number(raw?.status_id ?? raw?.status?.id);
        if (pid !== pipelineId || sid !== statusId) continue;
        scanned += 1;

        const social = norm(raw?.contact?.social_id);
        const title = norm(raw?.title);
        const fn = norm(raw?.contact?.full_name ?? raw?.contact?.client?.full_name);

        const usernameOk = username ? (social === username || social === '@' + username) : false;
        const fullnameOk = fullname ? (title.includes(fullname) || fn.includes(fullname)) : false;

        if ((username && usernameOk) || (!username && fullnameOk) || (username && fullname && (usernameOk || fullnameOk))) {
          found = Number(raw?.id);
          hits.push({ id: found, title: raw?.title ?? '', full_name: raw?.contact?.full_name ?? null, social_id: raw?.contact?.social_id ?? null });
          break;
        }
      }

      if (found || !hasNext) break;
      page += 1;
    }

    return NextResponse.json({
      ok: true,
      found_card_id: found,
      stats: { scanned, pages_used: page, per_page, max_pages },
      hits,
      used: { username: username || null, fullname: fullname || null, pipeline_id: pipelineId, status_id: statusId }
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
