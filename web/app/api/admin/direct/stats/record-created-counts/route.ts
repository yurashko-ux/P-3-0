// web/app/api/admin/direct/stats/record-created-counts/route.ts
// F4: нові записи на платну — не «усі з датою створення», а перший платний (paidRecordsInHistoryCount=0)
// і не перезапис (paidServiceIsRebooking !== true). Місяць/день — paidServiceRecordCreatedAt у Kyiv, cost > 0.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKyivDayUtcBounds, getTodayKyiv } from "@/lib/direct-stats-config";
import {
  startOfMonthKyivFromDay,
  endOfMonthKyivFromDay,
} from "@/lib/direct-f4-client-match";
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

    const f4WhereBase = {
      paidServiceTotalCost: { gt: 0 } as const,
      paidRecordsInHistoryCount: 0,
      paidServiceIsRebooking: { not: true },
    };

    /** Список клієнтів F4 для діагностики: ?includeClients=1 */
    const includeClients =
      req.nextUrl.searchParams.get("includeClients") === "1" ||
      req.nextUrl.searchParams.get("includeClients") === "true";

    const f4ClientListSelect = {
      id: true,
      firstName: true,
      lastName: true,
      instagramUsername: true,
      paidServiceRecordCreatedAt: true,
    } as const;

    const whereMonth = {
      ...f4WhereBase,
      paidServiceRecordCreatedAt: {
        gte: monthStartUtc,
        lt: monthEndExclusiveUtc,
      },
    };
    const whereToday = {
      ...f4WhereBase,
      paidServiceRecordCreatedAt: {
        gte: todayStartUtc,
        lt: todayEndUtc,
      },
    };

    // monthToDate: увесь календарний місяць Kyiv (1-ше — останній день включно)
    const [monthToDate, today, clientsMonthToDate, clientsToday] = await Promise.all([
      prisma.directClient.count({ where: whereMonth }),
      prisma.directClient.count({ where: whereToday }),
      includeClients
        ? prisma.directClient.findMany({
            where: whereMonth,
            select: f4ClientListSelect,
            orderBy: { paidServiceRecordCreatedAt: "desc" },
          })
        : Promise.resolve(null),
      includeClients
        ? prisma.directClient.findMany({
            where: whereToday,
            select: f4ClientListSelect,
            orderBy: { paidServiceRecordCreatedAt: "desc" },
          })
        : Promise.resolve(null),
    ]);

    const mapClientRow = (c: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      instagramUsername: string;
      paidServiceRecordCreatedAt: Date | null;
    }) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      instagramUsername: c.instagramUsername,
      paidServiceRecordCreatedAt: c.paidServiceRecordCreatedAt?.toISOString() ?? null,
    });

    console.log("[record-created-counts] Підрахунок F4 (нові: history=0, не rebooking):", {
      todayKyiv,
      startOfMonthKyiv,
      endOfMonthKyiv,
      monthStartUtc: monthStartUtc.toISOString(),
      monthEndExclusiveUtc: monthEndExclusiveUtc.toISOString(),
      todayStartUtc: todayStartUtc.toISOString(),
      todayEndUtc: todayEndUtc.toISOString(),
      monthToDate,
      today,
      includeClients,
    });

    return NextResponse.json({
      ok: true,
      todayKyiv,
      monthToDate,
      today,
      ...(includeClients && clientsMonthToDate && clientsToday
        ? {
            clientsMonthToDate: clientsMonthToDate.map(mapClientRow),
            clientsToday: clientsToday.map(mapClientRow),
          }
        : {}),
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
