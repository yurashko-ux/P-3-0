// web/app/api/campaigns/repair/route.ts
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  unwrapDeep,
  uniqIds,
  normalizeId,
  normalizeCampaign,
  type Campaign,
} from '@/lib/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Легкий «repair»: приводить списки ids до масивів, чистить дублі,
 * і не дає впасти якщо в Upstash ключі містять не той тип.
 */
export async function GET() {
  // читаємо те, що могли зберігати як списки id
  async function readIds(key: string): Promise<string[]> {
    try {
      const raw = await kv.get(key);
      const arr = unwrapDeep<any[]>(raw);
      if (Array.isArray(arr)) return uniqIds(arr);
      // якщо колись ключ був «рядком JSON масиву»
      const fromStr = unwrapDeep<any[]>(String(raw ?? ''));
      return Array.isArray(fromStr) ? uniqIds(fromStr) : [];
    } catch {
      return [];
    }
  }

  const ro = await readIds('cmp:list:ids:RO');
  const wr = await readIds('cmp:list:ids:WR');

  // зберігаємо нормалізовано
  await kv.set('cmp:list:ids:RO', ro);
  await kv.set('cmp:list:ids:WR', wr);

  // пробуємо почистити/нормалізувати запис «campaigns», якщо це був не той тип
  try {
    const val = await kv.get('campaigns'); // міг бути set не тим типом
    const obj = unwrapDeep<any>(val);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      // ок — залишаємо як є
    } else {
      // не очікуваний тип — приберемо, щоб далі не заважав
      await kv.del('campaigns');
    }
  } catch {
    // ігноруємо
  }

  return NextResponse.json({
    ok: true,
    repaired: { roCount: ro.length, wrCount: wr.length },
  });
}
