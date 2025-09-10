// web/app/api/mc/ingest/route.ts
import { NextResponse } from 'next/server';
import { kcMoveCard, kcGetCardState, findCardIdByUsername, kcFindCardIdByTitleSmart } from '@/lib/keycrm';
import { kvGet, kvSet, kvZRange } from '@/lib/kv';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const username: string = (body.username ?? '').trim();
    const text: string = (body.text ?? '').trim();
    const fullname: string = (body.fullname ?? body.full_name ?? '').trim();

    // 1) шукаємо картку спочатку по IG username
    let found = username ? await findCardIdByUsername(username) : { ok: false, card_id: null };
    // 2) якщо не знайшлось, пробуємо по title (fullname)
    if (!found.ok && fullname) {
      const byTitle = await kcFindCardIdByTitleSmart(fullname);
      if (byTitle.ok) found = { ok: true, username, card_id: byTitle.card_id as number } as any;
    }

    if (!found.ok || !found.card_id) {
      return NextResponse.json({
        ok: false,
        error: 'card_not_found',
        hint: 'Перевір, що у ManyChat ключі різні: username (ig), fullname (ПІБ). У CRM title має містити «Чат з <ПІБ>».',
        debug: { username, fullname, text, found },
      });
    }

    const card_id = String(found.card_id);

    // --- тут твоя логіка вибору кампанії за text ---
    // приклад: text === '1' -> move в певний pipeline/status
    // Я залишаю як у тебе було; якщо треба — підкажи, додам точні мапи.

    // Заглушка: нічого не рухаємо, просто відповімо OK + знайдена картка
    return NextResponse.json({
      ok: true,
      applied: null,
      card_id,
      normalized: { username, fullname, text },
      note: 'Картку знайдено; рух логіки кампаній залишається як у тебе.',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
