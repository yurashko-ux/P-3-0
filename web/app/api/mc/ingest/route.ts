// web/app/api/mc/ingest/route.ts
import { NextResponse } from 'next/server';
import { kvGet } from '@/lib/kv';
import { kcFindCardIdByTitle, kcMoveCard } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

/**
 * Очікує JSON:
 * { username: "instagram_username_id", text: "1|2|..." }
 * Опціонально: { card_id: "486" }
 * Логіка:
 *  1) Якщо передано card_id — працюємо з ним
 *  2) Інакше шукаємо map:ig:{username} у KV
 *  3) Інакше АВТОПОШУК у KeyCRM: card.title === username  -> беремо card.id
 *  4) Далі застосовуємо кампанію за текстом (V1/V2/EXP)
 */

function str(v: any, d = '') { return v == null ? d : String(v); }
function num(v: any, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

async function resolveCardId(username: string, providedCardId?: string | number) {
  // 1) Явно передали
  if (providedCardId) return String(providedCardId);

  // 2) KV мапінг
  const map = username ? await kvGet(`map:ig:${username}`) : null;
  if (map) {
    try {
      const j = JSON.parse(map);
      if (j?.value) return String(j.value);
    } catch {}
    return String(map);
  }

  // 3) АВТОПОШУК у KeyCRM за title
  if (username) {
    const found = await kcFindCardIdByTitle(username);
    if (found) return String(found);
  }

  return '';
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = str(body.username).trim();
    const text = str(body.text).trim();
    const providedCardId = str(body.card_id || '');

    const cardId = await resolveCardId(username, providedCardId);

    if (!cardId) {
      return NextResponse.json({
        ok: false,
        via: 'manychat',
        normalized: { username, text },
        error: 'card not found: no card_id and not found by title in KeyCRM',
        hint: 'Створіть у KeyCRM картку з title = instagram username_id або передавайте card_id',
      }, { status: 200 });
    }

    // ---- нижче приклад застосування "кампанії" по тексту (1 чи 2 чи EXP) ----
    // Ти вже маєш свою логіку з вибором кампанії, пайплайна і статусів.
    // Тут лише показую, як викликати move:

    // приклад: для "1" — перемістити картку в {pipeline_id: X, status_id: Y}
    let move: any = null;
    if (text === '1') {
      move = await kcMoveCard(cardId, {
        // приклад; підстав свої поля
        status_id: 130,       // <-- твій статус
        pipeline_id: 13,      // <-- твій пайплайн
        note: `V1 by @${username}`,
      });
    } else if (text === '2') {
      move = await kcMoveCard(cardId, {
        status_id: 222,       // <-- приклад
        pipeline_id: 22,
        note: `V2 by @${username}`,
      });
    } else {
      // інше/EXP тощо...
      move = { ok: true, status: 202, via: 'noop' };
    }

    const applied = text === '1' ? 'v1' : text === '2' ? 'v2' : 'exp?';

    return NextResponse.json({
      ok: true,
      via: 'manychat',
      normalized: { username, text },
      resolved: { card_id: cardId },
      applied,
      move,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ingest failed' }, { status: 500 });
  }
}
