// web/app/api/admin/direct/stats/leads-masters/route.ts
// Розбивка «Ліди» по майстрах — periodStats (консультації факт) + F4 (записи).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { getTodayKyiv } from "@/lib/direct-stats-config";
import {
  buildLeadsMasterRowsOutput,
  buildMasterIndex,
  computeLeadsMasterCountsForAnchor,
  getLeadsMonthAnchorDate,
  getPeriodStatsConsultFactPast,
  monthKeysFromYearStart,
  sumAllMasterCounts,
  sumMasterCountsMaps,
  type LeadsMasterClient,
} from "@/lib/direct-leads-masters-stats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get("host") || "")) return true;

  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
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

function isValidMonth(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}$/.test(value);
}

function conversionPct(consultationsFact: number, recordsCount: number): number {
  return consultationsFact > 0 ? Math.round((recordsCount / consultationsFact) * 100) : 0;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const throughMonth = req.nextUrl.searchParams.get("throughMonth");
    if (!isValidMonth(throughMonth)) {
      return NextResponse.json({ ok: false, error: "throughMonth must be YYYY-MM" }, { status: 400 });
    }

    const monthKeys = monthKeysFromYearStart(throughMonth);
    const year = throughMonth.slice(0, 4);
    const yearLabel = `${year} р.`;
    const todayKyiv = getTodayKyiv();

    const masters = await prisma.directMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true, altegioStaffId: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    const clients = (await prisma.directClient.findMany({
      select: {
        id: true,
        consultationBookingDate: true,
        consultationAttended: true,
        consultationCancelled: true,
        consultationMasterId: true,
        consultationMasterName: true,
        paidServiceRecordCreatedAt: true,
        paidServiceTotalCost: true,
        paidRecordsInHistoryCount: true,
        paidServiceIsRebooking: true,
        serviceMasterName: true,
        serviceMasterAltegioStaffId: true,
      },
    })) as LeadsMasterClient[];

    const index = buildMasterIndex(masters);
    const countsByMonth = new Map<string, ReturnType<typeof computeLeadsMasterCountsForAnchor>>();
    const debugMonths: Array<{ monthKey: string; periodStatsFact: number; mastersSum: number }> = [];

    for (const monthKey of monthKeys) {
      const anchor = getLeadsMonthAnchorDate(monthKey, todayKyiv);
      const counts = computeLeadsMasterCountsForAnchor(clients, anchor, index);
      countsByMonth.set(monthKey, counts);

      const periodStatsFact = getPeriodStatsConsultFactPast(clients, anchor);
      const mastersSum = sumAllMasterCounts(counts).consultationsFact;
      if (periodStatsFact !== mastersSum) {
        console.warn("[direct/stats/leads-masters] Розбіжність consultFact:", {
          monthKey,
          anchor,
          periodStatsFact,
          mastersSum,
        });
      }
      debugMonths.push({ monthKey, periodStatsFact, mastersSum });
    }

    const monthsOut = monthKeys.map((monthKey) => ({
      monthKey,
      masters: buildLeadsMasterRowsOutput(countsByMonth.get(monthKey)!, index),
    }));

    const ytdCounts = sumMasterCountsMaps([...countsByMonth.values()]);
    const ytdMasters = buildLeadsMasterRowsOutput(ytdCounts, index);
    const ytdTotal = sumAllMasterCounts(ytdCounts);

    console.log("[direct/stats/leads-masters] Підрахунок (periodStats):", {
      throughMonth,
      ytdConsultFact: ytdTotal.consultationsFact,
      ytdRecords: ytdTotal.recordsCount,
      debugMonths,
    });

    return NextResponse.json({
      ok: true,
      throughMonth,
      yearLabel,
      months: monthsOut,
      ytd: {
        masters: ytdMasters,
        totals: {
          consultationsFact: ytdTotal.consultationsFact,
          recordsCount: ytdTotal.recordsCount,
          conversionPct: conversionPct(ytdTotal.consultationsFact, ytdTotal.recordsCount),
        },
      },
    });
  } catch (err) {
    console.error("[direct/stats/leads-masters] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
