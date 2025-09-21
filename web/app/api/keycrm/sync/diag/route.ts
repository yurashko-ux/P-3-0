// web/app/api/keycrm/sync/diag/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvZRange } from '@/lib/kv';

const INDEX = 'campaigns:index';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await assertAdmin(req);

    // Пробуємо без опції {rev:true}, щоб уникнути несумісності в рантаймі
    let ids: string[] = [];
    try {
      ids = (await kvZRange(INDEX, 0, -1)) || [];
    } catch (e) {
      // fallback: якщо щось пішло не так — не валимо весь ендпоінт
      ids = [];
    }

    const meta = {
      campaigns_index_count: ids.length,
      campaigns_index_head: ids.slice(0, 10),
      kv_health_probe: await kvGet<string>('health:probe').catch(() => null),
      time: new Date().toISOString(),
    };

    return NextResponse.json({ ok: true, meta }, { status: 200 });
  } catch (err: any) {
    // Повертаємо зрозумілу помилку замість «порожнього» 500
    const message =
      err?.issues?.[0]?.message ||
      err?.message ||
      'Internal error in /api/keycrm/sync/diag';
    const stack = (err?.stack as string | undefined) || undefined;

    return NextResponse.json(
      { ok: false, error: message, stack },
      { status: 500 },
    );
  }
}
