// web/app/api/admin/direct/today-records-total/route.ts
// API endpoint для підрахунку суми послуг за сьогодні (записи, створені сьогодні)

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { computeServicesTotalCostUAH, kyivDayFromISO } from '@/lib/altegio/records-grouping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/**
 * GET - отримати суму послуг за сьогодні (записи, створені сьогодні)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Отримуємо всі записи з records:log
    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);

    // Визначаємо сьогоднішній день в Europe/Kyiv
    const todayKyiv = kyivDayFromISO(new Date().toISOString()); // YYYY-MM-DD

    // Парсимо та фільтруємо записи, створені сьогодні
    const recordsCreatedToday = rawItems
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          // Upstash може повертати елементи як { value: "..." }
          if (
            parsed &&
            typeof parsed === 'object' &&
            'value' in parsed &&
            typeof parsed.value === 'string'
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((r) => {
        if (!r || r.status !== 'create') return false; // Тільки записи зі статусом 'create'
        const receivedAt = r.receivedAt;
        if (!receivedAt) return false;
        const receivedDay = kyivDayFromISO(receivedAt); // День отримання вебхука про створення
        return receivedDay === todayKyiv; // Порівнюємо дні в Europe/Kyiv
      });

    // Рахуємо суму послуг
    let total = 0;
    for (const record of recordsCreatedToday) {
      try {
        const services = record.data?.services || record.services || [];
        const cost = computeServicesTotalCostUAH(Array.isArray(services) ? services : []);
        total += cost;
      } catch (err) {
        console.warn('[today-records-total] Failed to compute cost:', err);
      }
    }

    return NextResponse.json({ ok: true, total });
  } catch (error) {
    console.error('[direct/today-records-total] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
