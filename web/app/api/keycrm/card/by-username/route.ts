// web/app/api/keycrm/card/by-username/route.ts
import { NextResponse } from 'next/server';
import { findCardIdByUsername } from '../../../../../lib/keycrm';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const username = (searchParams.get('username') || '').trim();

    if (!username) {
      return NextResponse.json(
        { ok: false, error: 'username required' },
        { status: 400 }
      );
    }

    const result = await findCardIdByUsername(username);
    return NextResponse.json({ ok: true, username, result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'unexpected error' },
      { status: 500 }
    );
  }
}
