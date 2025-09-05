import { NextResponse, NextRequest } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  return NextResponse.json({
    ok: true,
    route: 'public/health',
    ts: Date.now(),
  });
}

// не обов'язково, але хай не буде 405 на префлайтах
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'allow': 'GET,OPTIONS',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-origin': '*',
    },
  });
}
