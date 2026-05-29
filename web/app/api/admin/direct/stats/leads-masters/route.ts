// web/app/api/admin/direct/stats/leads-masters/route.ts
// Розбивка «Ліди» по майстрах — periodStats (консультації факт) + F4; майстер з Altegio KV.

import { NextRequest, NextResponse } from "next/server";
import { kvRead } from "@/lib/kv";
import { prisma } from "@/lib/prisma";
import { verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { getTodayKyiv, KV_LIMIT_RECORDS, KV_LIMIT_WEBHOOK } from "@/lib/direct-stats-config";
import {
  buildGroupsByAltegioClient,
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

    const [masters, clients, rawRecords, rawWebhooks] = await Promise.all([
      prisma.directMaster.findMany({
        where: { isActive: true },
        select: { id: true, name: true, altegioStaffId: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      prisma.directClient.findMany({
        select: {
          id: true,
          altegioClientId: true,
          consultationBookingDate: true,
          consultationAttended: true,
          consultationCancelled: true,
          consultationMasterId: true,
          consultationMasterName: true,
          masterId: true,
          paidServiceRecordCreatedAt: true,
          paidServiceTotalCost: true,
          paidRecordsInHistoryCount: true,
          paidServiceIsRebooking: true,
          serviceMasterName: true,
          serviceMasterAltegioStaffId: true,
        },
      }),
      kvRead.lrange("altegio:records:log", 0, KV_LIMIT_RECORDS - 1),
      kvRead.lrange("altegio:webhook:log", 0, KV_LIMIT_WEBHOOK - 1),
    ]);

    const typedClients = clients as LeadsMasterClient[];
    const groupsByClient = buildGroupsByAltegioClient(rawRecords, rawWebhooks);
    const index = buildMasterIndex(masters);

    const countsByMonth = new Map<string, ReturnType<typeof computeLeadsMasterCountsForAnchor>["counts"]>();
    const debugMonths: Array<{
      monthKey: string;
      periodStatsFact: number;
      mastersSum: number;
      unmappedConsults: number;
    }> = [];
    let totalUnmappedConsults = 0;

    for (const monthKey of monthKeys) {
      const anchor = getLeadsMonthAnchorDate(monthKey, todayKyiv);
      const { counts, unmappedConsults } = computeLeadsMasterCountsForAnchor(
        typedClients,
        anchor,
        index,
        groupsByClient
      );
      countsByMonth.set(monthKey, counts);
      totalUnmappedConsults += unmappedConsults;

      const periodStatsFact = getPeriodStatsConsultFactPast(typedClients, anchor);
      const mastersSum = sumAllMasterCounts(counts).consultationsFact;
      if (periodStatsFact !== mastersSum) {
        console.warn("[direct/stats/leads-masters] Розбіжність consultFact:", {
          monthKey,
          anchor,
          periodStatsFact,
          mastersSum,
          unmappedConsults,
        });
      }
      debugMonths.push({ monthKey, periodStatsFact, mastersSum, unmappedConsults });
    }

    const monthsOut = monthKeys.map((monthKey) => ({
      monthKey,
      masters: buildLeadsMasterRowsOutput(countsByMonth.get(monthKey)!),
    }));

    const ytdCounts = sumMasterCountsMaps([...countsByMonth.values()]);
    const ytdMasters = buildLeadsMasterRowsOutput(ytdCounts);
    const ytdTotal = sumAllMasterCounts(ytdCounts);

    console.log("[direct/stats/leads-masters] Підрахунок (periodStats + KV):", {
      throughMonth,
      ytdConsultFact: ytdTotal.consultationsFact,
      ytdRecords: ytdTotal.recordsCount,
      totalUnmappedConsults,
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
      debug: { totalUnmappedConsults, months: debugMonths },
    });
  } catch (err) {
    console.error("[direct/stats/leads-masters] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
