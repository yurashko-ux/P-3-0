// app/api/keycrm/card/by-username/route.ts
import { NextResponse } from 'next/server';
import { findCardIdByUsername } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // inputs
    const username =
      url.searchParams.get('username') ||
      url.searchParams.get('ig_username') ||
      url.searchParams.get('handle') ||
      '';
    const pipeline_id = url.searchParams.get('pipeline_id');
    const status_id = url.searchParams.get('status_id');

    // validation
    if (!username) {
      return NextResponse.json(
        { error: 'username is required' },
        { status: 400 },
      );
    }
    if (!pipeline_id || !status_id) {
      return NextResponse.json(
        { error: 'pipeline_id and status_id are required' },
        { status: 400 },
      );
    }

    // KV-based lookup via shim (expects object args)
    const cardId = await findCardIdByUsername({
      username,
      pipeline_id,
      status_id,
      limit: 50,
    });

    return NextResponse.json(
      { found: Boolean(cardId), cardId: cardId ?? null },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'failed' },
      { status: 500 },
    );
  }
}
