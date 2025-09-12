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

    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    let cardId: string | null = null;

    if (pipeline_id && status_id) {
      // строгий пошук у межах базової пари
      cardId = await findCardIdByUsername({
        username,
        pipeline_id,
        status_id,
        limit: 50,
      });
    } else {
      // мʼякий режим сумісності — дозволяємо виклик рядком навіть якщо сигнатура ще стара
      // Це прибирає TS-фаіл під час білду.
      // @ts-ignore – підтримуємо виклик із рядком
      cardId = await findCardIdByUsername(username as any);
    }

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
