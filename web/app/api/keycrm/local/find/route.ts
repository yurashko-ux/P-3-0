// web/app/api/keycrm/local/find/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';
import { normalizeManyChat, scoreByName } from '@/lib/ingest';

// KV-ключі, як у вашому документі:
// kc:index:social:instagram:{handle}  — ZSET(card_id)
// kc:index:cards:{pipeline_id}:{status_id} — ZSET(card_id)
// kc:card:{id} — нормалізована картка з sync

type Card = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_name: string | null; // "instagram" | ...
  contact_social_id: string | null;   // "@handle"
  contact_full_name: string | null;
  updated_at: string;                 // ISO або "YYYY-MM-DD ..."
};

const KC_SOCIAL_KEY = (handle: string) => `kc:index:social:instagram:${handle}`;
const KC_PAIR_KEY = (p: number, s: number) => `kc:index:cards:${p}:${s}`;
const KC_CARD_KEY = (id: string | number) => `kc:card:${id}`;

async function getCard(id: string | number): Promise<Card | null> {
  const raw = await kvGet<any>(KC_CARD_KEY(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as Card);
}

function byLatest(a: Card, b: Card) {
  const ta = Date.parse(a?.updated_at ?? '') || 0;
  const tb = Date.parse(b?.updated_at ?? '') || 0;
  return tb - ta;
}

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const url = new URL(req.url);
  // Параметри: username (IG), fullname (опц.), base pair (опц.)
  const username = url.searchParams.get('username') ?? '';
  const fullname = url.searchParams.get('fullname') ?? '';
  const pipelineId = Number(url.searchParams.get('pipeline_id') ?? '') || undefined;
  const statusId = Number(url.searchParams.get('status_id') ?? '') || undefined;

  const mc = normalizeManyChat({ username, full_name: fullname });

  // 1) Пріоритет: social_id (@handle або handle)
  if (mc.handle) {
    // Зберігаємо індекси і з @, і без @ — пробуємо обидва.
    const keys = [KC_SOCIAL_KEY(mc.handle), KC_SOCIAL_KEY(`@${mc.handle}`)];
    let ids: string[] = [];
    for (const k of keys) {
      try {
        const part: string[] = await kvZRange(k, 0, -1);
        if (part?.length) ids = ids.concat(part);
      } catch {
        // індексу може не бути — ідемо далі
      }
    }
    // унікалізуємо
    ids = Array.from(new Set(ids));

    if (ids.length === 1) {
      return NextResponse.json({ card_id: Number(ids[0]), via: 'social' }, { status: 200 });
    }
    if (ids.length > 1) {
      const cards = (await Promise.all(ids.map(getCard))).filter(Boolean) as Card[];
      if (cards.length) {
        cards.sort(byLatest);
        return NextResponse.json({ card_id: cards[0].id, via: 'social_latest' }, { status: 200 });
      }
    }
  }

  // 2) Fallback за ім'ям у межах базової пари, якщо вона задана
  if (pipelineId && statusId && mc.fullName) {
    const idxKey = KC_PAIR_KEY(pipelineId, statusId);
    let ids: string[] = [];
    try {
      ids = await kvZRange(idxKey, -300, -1); // останні ~300, якщо підтримується негативний початок
      if (!ids || ids.length === 0) {
        ids = await kvZRange(idxKey, 0, -1); // бекап
      }
    } catch {
      ids = [];
    }

    let best: { id: number; score: number } | null = null;
    for (const id of ids) {
      const card = await getCard(id);
      if (!card) continue;
      const tgt = [card.contact_full_name, card.title].filter(Boolean).join(' ');
      const sc = scoreByName(mc.fullName, tgt);
      if (!best || sc > best.score) best = { id: Number(id), score: sc };
    }

    if (best && best.score >= 60) {
      return NextResponse.json({ card_id: best.id, via: 'name_fallback', score: best.score }, { status: 200 });
    }
  }

  return NextResponse.json({ card_id: null, via: 'not_found' }, { status: 200 });
}
