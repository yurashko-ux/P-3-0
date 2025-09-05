import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, route: 'mc/ingest', allow: ['GET','POST'] });
}

export async function POST(req: NextRequest) {
  let payload: any = {};
  try { payload = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  // тут поки ехо-відповідь (щоб проксі мав куди форвардити без 404)
  return NextResponse.json({
    ok: true,
    route: 'mc/ingest',
    received: payload,
    meta: { forwardedBy: req.headers.get('x-forwarded-by') || null }
  });
}
