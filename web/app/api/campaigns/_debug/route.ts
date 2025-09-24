// web/app/api/campaigns/_debug/route.ts
import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// Ті ж ключі, що й у /api/campaigns (LIST-схема)
const LIST_KEY = 'campaigns:index';     // список id (LPUSH/RPUSH)
const ITEMS_KEY = 'campaigns:items';    // список JSON-об’єктів (LPUSH/RPUSH)
const ITEM_KEY = (id: string | number) => `campaigns:item:${id}`;

export async function GET() {
  const started = Date.now();

  try {
    // Читаємо все тільки через LRANGE — без zrange
    const listIds = await redis.lrange(LIST_KEY, 0, -1).catch(() => []);
    const itemsRaw = await redis.lrange(ITEMS_KEY, 0, -1).catch(() => []);

    // Парсимо JSON, але без крешів
    const itemsParsed = itemsRaw.map((r) => {
      try { return r ? JSON.parse(r) : null; } catch { return null; }
    }).filter(Boolean);

    // Спробуємо дістати перший елемент також через одиночний ключ — якщо існує
    let sampleId: string | null = null;
    let sampleRaw: string | null = null;
    let sample: any = null;

    if (listIds?.[0]) {
      sampleId = listIds[0];
      sampleRaw = await redis.get(ITEM_KEY(sampleId));
      if (sampleRaw) {
        try { sample = JSON.parse(sampleRaw); } catch { sample = sampleRaw; }
      }
    }

    const took = Date.now() - started;

    return NextResponse.json({
      ok: true,
      took_ms: took,
      list: {
        key: LIST_KEY,
        length: listIds.length,
        ids: listIds,
      },
      items: {
        key: ITEMS_KEY,
        length: itemsRaw.length,
        raw: itemsRaw,
        parsed: itemsParsed,
      },
      sample: {
        id: sampleId,
        item_key: sampleId ? ITEM_KEY(sampleId) : null,
        raw: sampleRaw,
        parsed: sample,
      },
      note: 'Цей debug-ендпоінт використовує тільки LRANGE/GET. Z* команди не застосовуються.',
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: 'debug_failed',
      message: e?.message || String(e),
    }, { status: 500 });
  }
}
