// web/app/api/admin/direct/stats/record-created-counts/route.ts
// F4 з БД: monthToDate — увесь календарний місяць Kyiv (до кінця останнього дня); today — лише день з ?day=.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKyivDayUtcBounds, getTodayKyiv } from "@/lib/direct-stats-config";
import { verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get("host") || "")) return true;

  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  // Той самий токен сесії, що й GET /api/admin/direct/clients (RBAC)
  if (verifyUserToken(adminToken)) return true;

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

/** Останній календарний день місяця (YYYY-MM-DD, Kyiv) для дати в цьому ж місяці. */
function endOfMonthKyivFromDay(kyivDay: string): string {
  const m = kyivDay.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return kyivDay;
  const y = Number(m[1]);
  const month1to12 = Number(m[2]);
  const lastDay = new Date(y, month1to12, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m[1]}-${m[2]}-${pad(lastDay)}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dayParam = req.nextUrl.searchParams.get("day") || "";
    const todayKyiv = getTodayKyiv(dayParam);
    const startOfMonthKyiv = startOfMonthKyivFromDay(todayKyiv);
    const endOfMonthKyiv = endOfMonthKyivFromDay(todayKyiv);

    const { startUtc: monthStartUtc } = getKyivDayUtcBounds(startOfMonthKyiv);
    const { endUtc: monthEndExclusiveUtc } = getKyivDayUtcBounds(endOfMonthKyiv);
    const { startUtc: todayStartUtc, endUtc: todayEndUtc } = getKyivDayUtcBounds(todayKyiv);

    const costPositive = { paidServiceTotalCost: { gt: 0 } };

    // monthToDate: увесь календарний місяць Kyiv (1-ше — останній день включно), навіть якщо останній день ще не настав
    const [monthToDate, today] = await Promise.all([
      prisma.directClient.count({
        where: {
          ...costPositive,
          paidServiceRecordCreatedAt: {
            gte: monthStartUtc,
            lt: monthEndExclusiveUtc,
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
      endOfMonthKyiv,
      monthStartUtc: monthStartUtc.toISOString(),
      monthEndExclusiveUtc: monthEndExclusiveUtc.toISOString(),
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
