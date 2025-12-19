// web/app/api/admin/direct/stats/route.ts
// API endpoint для статистики Direct

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import type { DirectStats } from '@/lib/direct-types';

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
 * GET - отримати статистику
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clients = await getAllDirectClients();

    // Унікалізуємо клієнтів за Instagram, щоб не рахувати дублікати
    const uniqueMap = new Map<string, typeof clients[number]>();
    const normalize = (username: string) => username.trim().toLowerCase();

    for (const client of clients) {
      const key = normalize(client.instagramUsername);
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, client);
      }
    }

    const uniqueClients = Array.from(uniqueMap.values());

    // Підрахунок по статусах
    const byStatus: Record<string, number> = {};
    uniqueClients.forEach((c) => {
      byStatus[c.statusId] = (byStatus[c.statusId] || 0) + 1;
    });

    // Конверсія 1: Запис на консультацію → Візит в салон
    const consultationsWithMaster = uniqueClients.filter(
      (c) => c.statusId === 'consultation' && c.masterId && c.consultationDate
    ).length;
    const visitedSalon = uniqueClients.filter((c) => c.visitedSalon).length;
    const conversion1Rate = consultationsWithMaster > 0
      ? (visitedSalon / consultationsWithMaster) * 100
      : 0;

    // Конверсія 2: Візит в салон → Запис на платну послугу
    const signedUpForPaid = uniqueClients.filter((c) => c.signedUpForPaidService).length;
    const conversion2Rate = visitedSalon > 0
      ? (signedUpForPaid / visitedSalon) * 100
      : 0;

    // Загальна конверсія: Запис на консультацію → Запис на платну послугу
    const overallConversionRate = consultationsWithMaster > 0
      ? (signedUpForPaid / consultationsWithMaster) * 100
      : 0;

    const stats: DirectStats = {
      totalClients: uniqueClients.length,
      byStatus,
      conversion1: {
        consultationsWithMaster,
        visitedSalon,
        rate: Math.round(conversion1Rate * 10) / 10, // Округлюємо до 1 знака після коми
      },
      conversion2: {
        visitedSalon,
        signedUpForPaid,
        rate: Math.round(conversion2Rate * 10) / 10,
      },
      overallConversion: {
        consultationsWithMaster,
        signedUpForPaid,
        rate: Math.round(overallConversionRate * 10) / 10,
      },
    };

    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    console.error('[direct/stats] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
