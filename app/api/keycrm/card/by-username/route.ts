// app/api/keycrm/card/by-username/route.ts
import { NextResponse } from 'next/server';
import { findCardIdByUsername } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const username =
      url.searchParams.get('username') ||
      url.searchParams.get('ig_username') ||
      url.searchParams.get('handle') ||
      '';

    const pipeline_id = url.searchParams.get('pipeline_id') || undefined;
    const status_id = url.searchParams.get('status_id') || undefined;

    if (!username) {
      return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 });
    }

    // ВАЖЛИВО: передаємо ОБ’ЄКТ, а тип глушимо через `as any`,
    // щоб не впасти навіть якщо lib очікує саме об’єкт.
    const args = { username, pipeline_id, status_id, limit: 50 };
    const cardId = await (findCardIdByUsername as any)(args);

    return NextResponse.json(
      { ok: true, found: Boolean(cardId), cardId: cardId ?? null },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'failed' },
      { status: 500 }
    );
  }
}
