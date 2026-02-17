// web/app/api/admin/direct/debug-consultation-created/route.ts
// Діагностика: consultationRecordCreatedAt — чому «Консультація» показує 0?

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const todayKyiv = kyivDayFromISO(new Date().toISOString());

  try {
    // 1. Загальна статистика consultationRecordCreatedAt
    const totalClients = await prisma.directClient.count();
    const withConsultCreatedAt = await prisma.directClient.count({
      where: { consultationRecordCreatedAt: { not: null } },
    });
    const withConsultBookingToday = await prisma.directClient.count({
      where: {
        consultationBookingDate: { not: null },
        altegioClientId: { not: null },
      },
    });

    // 2. Кількість і приклади: consultationRecordCreatedAt = сьогодні (Europe/Kyiv)
    const todayCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM "direct_clients"
      WHERE "consultationRecordCreatedAt" IS NOT NULL
      AND ("consultationRecordCreatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date = ${todayKyiv}::date
    `;
    const todayCount = Number(todayCountResult[0]?.count ?? 0);

    const todayFromDb = await prisma.$queryRaw<
      Array<{ id: string; consultationRecordCreatedAt: Date; consultationBookingDate: Date | null }>
    >`
      SELECT id, "consultationRecordCreatedAt", "consultationBookingDate"
      FROM "direct_clients"
      WHERE "consultationRecordCreatedAt" IS NOT NULL
      AND ("consultationRecordCreatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date = ${todayKyiv}::date
      LIMIT 20
    `;

    // 3. Клієнти з consultationBookingDate = сьогодні, але consultationRecordCreatedAt = null
    const bookingTodayNoCreatedAt = await prisma.$queryRaw<
      Array<{ id: string; consultationBookingDate: Date; consultationRecordCreatedAt: Date | null }>
    >`
      SELECT id, "consultationBookingDate", "consultationRecordCreatedAt"
      FROM "direct_clients"
      WHERE "consultationBookingDate" IS NOT NULL
      AND ("consultationBookingDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kiev')::date = ${todayKyiv}::date
      AND "consultationRecordCreatedAt" IS NULL
      AND "altegioClientId" IS NOT NULL
      LIMIT 10
    `;

    // 4. Останні 5 клієнтів з consultationRecordCreatedAt (для перевірки формату)
    const recentWithCreatedAt = await prisma.directClient.findMany({
      where: { consultationRecordCreatedAt: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        consultationRecordCreatedAt: true,
        consultationBookingDate: true,
        altegioClientId: true,
      },
      orderBy: { consultationRecordCreatedAt: 'desc' },
      take: 5,
    });

    const result = {
      ok: true,
      todayKyiv,
      timestamp: new Date().toISOString(),
      stats: {
        totalClients,
        withConsultRecordCreatedAt: withConsultCreatedAt,
        withConsultBookingToday,
        consultationCreatedTodayCount: todayCount,
      },
      consultationCreatedToday: todayFromDb.map((r) => ({
        id: r.id,
        consultationRecordCreatedAt: r.consultationRecordCreatedAt?.toISOString(),
        consultationBookingDate: r.consultationBookingDate?.toISOString(),
      })),
      bookingTodayNoCreatedAt: bookingTodayNoCreatedAt.map((r) => ({
        id: r.id,
        consultationBookingDate: r.consultationBookingDate?.toISOString(),
        consultationRecordCreatedAt: r.consultationRecordCreatedAt,
      })),
      recentWithCreatedAt: recentWithCreatedAt.map((r) => ({
        id: r.id,
        name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        consultationRecordCreatedAt: r.consultationRecordCreatedAt?.toISOString(),
        consultationBookingDate: r.consultationBookingDate?.toISOString(),
        altegioClientId: r.altegioClientId,
      })),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[debug-consultation-created] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
