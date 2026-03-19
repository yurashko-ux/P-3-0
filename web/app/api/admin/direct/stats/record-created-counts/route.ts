// web/app/api/admin/direct/stats/record-created-counts/route.ts
// Кількість нових записів на платну послугу напряму з БД (Prisma), для комірки F4 на сторінці Статистика.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKyivDayUtcBounds, getTodayKyiv } from "@/lib/direct-stats-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get("secret");
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

/** Перший день місяця YYYY-MM-01 для дати YYYY-MM-DD (Kyiv). */
function startOfMonthKyivFromDay(kyivDay: string): string {
  const m = kyivDay.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return kyivDay;
  return `${m[1]}-${m[2]}-01`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dayParam = req.nextUrl.searchParams.get("day") || "";
    const todayKyiv = getTodayKyiv(dayParam);
    const startOfMonthKyiv = startOfMonthKyivFromDay(todayKyiv);

    const { startUtc: monthStartUtc } = getKyivDayUtcBounds(startOfMonthKyiv);
    const { startUtc: todayStartUtc, endUtc: todayEndUtc } = getKyivDayUtcBounds(todayKyiv);

    const costPositive = { paidServiceTotalCost: { gt: 0 } };

    const [monthToDate, today] = await Promise.all([
      prisma.directClient.count({
        where: {
          ...costPositive,
          paidServiceRecordCreatedAt: {
            gte: monthStartUtc,
            lt: todayEndUtc,
          },
        },
      }),
      prisma.directClient.count({
        where: {
          ...costPositive,
          paidServiceRecordCreatedAt: {
            gte: todayStartUtc,
            lt: todayEndUtc,
          },
        },
      }),
    ]);

    console.log("[record-created-counts] Підрахунок F4 з БД:", {
      todayKyiv,
      startOfMonthKyiv,
      monthStartUtc: monthStartUtc.toISOString(),
      todayStartUtc: todayStartUtc.toISOString(),
      todayEndUtc: todayEndUtc.toISOString(),
      monthToDate,
      today,
    });

    return NextResponse.json({
      ok: true,
      todayKyiv,
      monthToDate,
      today,
    });
  } catch (err) {
    console.error("[record-created-counts] Помилка:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
