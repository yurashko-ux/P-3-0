import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  return NextResponse.json({
    ok: true,
    where: 'web/src/app/api/public/diag-b/route.ts',
    ts: Date.now(),
  });
}

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
