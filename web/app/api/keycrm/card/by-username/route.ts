// web/app/api/keycrm/card/by-username/route.ts
import { NextResponse } from 'next/server';
import { findCardIdByUsername } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const username = url.searchParams.get('username') || '';
    const found = await findCardIdByUsername(username);
    return NextResponse.json(found, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
