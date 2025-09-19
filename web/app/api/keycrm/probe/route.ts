// web/app/api/keycrm/probe/route.ts
// Дуже простий live-пошук card_id у KeyCRM по IG username == contact.social_id
// Бере рівно одну сторінку з /pipelines/cards (без KV). Ідеально для перевірки.

import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kcListCards } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

// М’яка авторизація: Bearer ADMIN_PASS або ?pass=
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
    const usernameRaw = url.searchParams.get('username') || url.searchParams.get('handle') || '';
    const username = normHandle(usernameRaw);
    const pipelineId = Number(url.searchParams.get('pipeline_id') || '');
    const statusId = Number(url.searchParams.get('status_id') || '');
    const per_page = Number(url.searchParams.get('per_page') || '50') || 50;
    const page = Number(url.searchParams.get('page') || '1') || 1;

    if (!username) {
      return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
    }
    if (!Number.isFinite(pipelineId) || !Number.isFinite(statusId)) {
      return NextResponse.json({ ok: false, error: 'pipeline_id and status_id are required numbers' }, { status: 400 });
    }

    const { items, raw } = await kcListCards({
      page,
      per_page,
      pipeline_id: pipelineId,
      status_id: statusId,
    });

    const matches = [];
    for (const it of items) {
      const pid = Number(it?.status?.pipeline_id ?? it?.pipeline_id);
      const sid = Number(it?.status_id ?? it?.status?.id);
      if (pid !== pipelineId || sid !== statusId) continue;

      const social = norm(it?.contact?.social_id);
      if (social === username || social === '@' + username) {
        matches.push({
          id: Number(it?.id),
          title: it?.title ?? '',
          full_name: it?.contact?.full_name ?? it?.contact?.client?.full_name ?? null,
          social_id: it?.contact?.social_id ?? null,
          pipeline_id: pid,
          status_id: sid,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      found_count: matches.length,
      matches,
      used: { username: '@' + username, pipeline_id: pipelineId, status_id: statusId, page, per_page },
      note: 'Це проста перевірка: сканує лише одну сторінку. За потреби збільши ?per_page або змінюй ?page.',
      sample_of_raw_shape: Array.isArray(raw) ? 'array' : Object.keys(raw || {}),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
