// web/app/api/keycrm/sync/route.ts
// Заглушка-роут: показує, як викликати синк конкретної пари.
// Істинний синк відбувається у /api/keycrm/sync/pair

import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await assertAdmin(req);
    const url = new URL(req.url);
    const p = url.searchParams.get('pipeline_id');
    const s = url.searchParams.get('status_id');
    const per_page = url.searchParams.get('per_page') || '50';
    const max_pages = url.searchParams.get('max_pages') || '2';

    if (p && s) {
      // підказка на прямий виклик pair-синку
      const pairUrl =
        `/api/keycrm/sync/pair?pipeline_id=${encodeURIComponent(p)}&status_id=${encodeURIComponent(
          s!
        )}&per_page=${encodeURIComponent(per_page)}&max_pages=${encodeURIComponent(max_pages)}`;
      return NextResponse.json({
        ok: true,
        hint: 'Use /api/keycrm/sync/pair for actual indexing of a single pair',
        next: pairUrl,
      });
    }

    return NextResponse.json({
      ok: true,
      pairs: 0,
      hint:
        'Pass ?pipeline_id=<number>&status_id=<number>&per_page=50&max_pages=2 or call /api/keycrm/sync/pair directly',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
