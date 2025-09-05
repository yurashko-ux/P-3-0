import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// OPTIONS — не ловити 405/префлайти
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'allow': 'GET,POST,OPTIONS',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization,x-admin-pass,x-mc-token',
      'access-control-allow-origin': '*',
    },
  });
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: 'public/mc/ingest-proxy',
    allow: ['GET', 'POST', 'OPTIONS'],
  });
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return bad('content-type must be application/json', 415);
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { return bad('invalid JSON body', 400); }

  const KEYCRM_API_URL = (process.env.KEYCRM_API_URL || '').trim();
  const ADMIN_PASS = (process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || '').trim();

  // Якщо KEYCRM_API_URL немає — підтверджуємо прийом (нічого не ламаємо)
  if (!KEYCRM_API_URL) {
    return NextResponse.json({ ok: true, mode: 'keycrm:skipped_stub', accepted: payload });
  }

  // Форвардимо на захищений /api/mc/ingest
  const origin = `${req.nextUrl.protocol}//${req.headers.get('host')}`;

  try {
    const r = await fetch(`${origin}/api/mc/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ADMIN_PASS ? { 'x-admin-pass': ADMIN_PASS } : {}), // пройти middleware
        'x-forwarded-by': 'public-ingest-proxy',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    let data: any = {};
    try { data = await r.json(); } catch { data = { _note: 'non-JSON downstream' }; }

    return NextResponse.json(
      { ok: true, mode: 'forwarded', accepted: payload, downstream: { status: r.status, data } },
      { status: r.ok ? 200 : r.status },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: true, mode: 'forward_failed', accepted: payload, error: err?.message || 'fetch_failed' },
      { status: 502 },
    );
  }
}
