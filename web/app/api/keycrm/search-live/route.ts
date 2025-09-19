// web/app/api/keycrm/search-live/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kcListLeads } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

// м’яка авторизація: Bearer ADMIN_PASS або ?pass=
async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if ((expected && bearer === expected) || (expected && passParam === expected)) return true;
  try { await assertAdmin(req); return true; } catch { return false; }
}

function normHandle(s?: string | null) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.replace(/^@+/, '').toLowerCase();
}
const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized. Use Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const username = url.searchParams.get('username') || url.searchParams.get('handle') || '';
    const fullname = url.searchParams.get('fullname') || url.searchParams.get('name') || '';
    const p = Number(url.searchParams.get('pipeline_id') || '');
    const s = Number(url.searchParams.get('status_id') || '');
    const per_page = Number(url.searchParams.get('per_page') || '50') || 50;
    const max_pages = Number(url.searchParams.get('max_pages') || '2') || 2;

    if (!Number.isFinite(p) || !Number.isFinite(s)) {
      return NextResponse.json({ ok: false, error: 'pipeline_id and status_id are required numbers' }, { status: 400 });
    }

    const handle = normHandle(username);
    const handleAlt = handle ? '@' + handle : null;
    const needle = norm(fullname);

    let page = 1;
    let scanned = 0;
    let matchedId: number | null = null;
    const hits: Array<{ id: number; title: string; full_name: string | null; social_id: string | null }> = [];

    while (page <= max_pages) {
      const { items, hasNext } = await kcListLeads({
        page,
        per_page,
        pipeline_id: p,
        status_id: s,
        path: 'leads',
      });

      for (const raw of items) {
        const pid = Number(raw?.status?.pipeline_id ?? raw?.pipeline_id);
        const sid = Number(raw?.status_id ?? raw?.status?.id);
        if (pid !== p || sid !== s) continue;

        scanned += 1;

        const social = norm(raw?.contact?.social_id);
        const title = norm(raw?.title);
        const fn = norm(raw?.contact?.full_name ?? raw?.contact?.client?.full_name);

        const usernameOk = handle
          ? (social === handle || social === (handleAlt || ''))
          : false;

        const fullnameOk = needle ? (title.includes(needle) || fn.includes(needle)) : false;

        if ((handle && usernameOk) || (!handle && needle && fullnameOk) || (handle && needle && (usernameOk || fullnameOk))) {
          matchedId = Number(raw?.id);
          hits.push({
            id: Number(raw?.id),
            title: raw?.title ?? '',
            full_name: raw?.contact?.full_name ?? raw?.contact?.client?.full_name ?? null,
            social_id: raw?.contact?.social_id ?? null,
          });
          break;
        }
      }

      if (matchedId || !hasNext) break;
      page += 1;
    }

    return NextResponse.json({
      ok: true,
      found_card_id: matchedId,
      hits,
      stats: { scanned, pages_used: page, per_page, max_pages },
      used: { username: username || null, fullname: fullname || null, pipeline_id: p, status_id: s },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
