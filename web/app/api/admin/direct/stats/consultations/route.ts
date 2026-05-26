// web/app/api/admin/direct/stats/consultations/route.ts
// Список консультацій (consultationBookingDate) за місяць Kyiv — для вкладки «Консультації» в статистиці.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKyivDayUtcBounds, getTodayKyiv } from "@/lib/direct-stats-config";
import {
  startOfMonthKyivFromDay,
  endOfMonthKyivFromDay,
} from "@/lib/direct-f4-client-match";
import { verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { getMasterColumnNamesLikeTable } from "@/lib/direct-master-column-names";
import type { DirectClient } from "@/lib/direct-types";
import { getConsultationRowColorKey } from "@/lib/consultation-list-styles";

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

function getMonthAnchorDate(monthKey: string, todayKyiv: string): string {
  if (monthKey === todayKyiv.slice(0, 7)) return todayKyiv;
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return `${monthKey}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

export type ConsultationOutcome = "realized" | "cancelled" | "no_show" | "planned";

function getConsultationOutcome(client: {
  consultationAttended: boolean | null;
  consultationCancelled: boolean;
}): ConsultationOutcome {
  if (client.consultationCancelled) return "cancelled";
  if (client.consultationAttended === true) return "realized";
  if (client.consultationAttended === false) return "no_show";
  return "planned";
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const monthParam = (req.nextUrl.searchParams.get("month") || "").trim();
    const dayParam = (req.nextUrl.searchParams.get("day") || "").trim();
    const todayKyiv = getTodayKyiv();

    let monthKey: string;
    if (/^\d{4}-\d{2}$/.test(monthParam)) {
      monthKey = monthParam;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
      monthKey = getTodayKyiv(dayParam).slice(0, 7);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(monthParam)) {
      monthKey = monthParam.slice(0, 7);
    } else {
      monthKey = todayKyiv.slice(0, 7);
    }

    const anchorDay = getMonthAnchorDate(monthKey, todayKyiv);
    const startOfMonthKyiv = startOfMonthKyivFromDay(anchorDay);
    const endOfMonthKyiv = endOfMonthKyivFromDay(anchorDay);

    const { startUtc: monthStartUtc } = getKyivDayUtcBounds(startOfMonthKyiv);
    const { endUtc: anchorEndUtc } = getKyivDayUtcBounds(anchorDay);

    const masters = await prisma.directMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    const clients = await prisma.directClient.findMany({
      where: {
        consultationDeletedInAltegio: false,
        consultationBookingDate: {
          gte: monthStartUtc,
          lt: anchorEndUtc,
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        instagramUsername: true,
        source: true,
        firstContactDate: true,
        consultationBookingDate: true,
        consultationAttended: true,
        consultationCancelled: true,
        isOnlineConsultation: true,
        consultationMasterName: true,
        serviceMasterName: true,
        masterId: true,
        paidServiceDate: true,
        paidServiceTotalCost: true,
        paidServiceVisitBreakdown: true,
        spent: true,
        signedUpForPaidService: true,
        signedUpForPaidServiceAfterConsultation: true,
        consultationListComment: true,
        consultationListOutcomeOverride: true,
      },
      orderBy: { consultationBookingDate: "desc" },
    });

    const mapped = clients.map((c) => {
      const outcome = getConsultationOutcome(c);
      const masterNames = getMasterColumnNamesLikeTable(c as unknown as DirectClient, masters);
      const masterDisplayName = masterNames.length > 0 ? masterNames.join(", ") : null;
      const rowColorKey = getConsultationRowColorKey({
        outcome,
        consultationListOutcomeOverride: c.consultationListOutcomeOverride,
        signedUpForPaidService: c.signedUpForPaidService,
        signedUpForPaidServiceAfterConsultation: c.signedUpForPaidServiceAfterConsultation,
      });
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        instagramUsername: c.instagramUsername,
        source: c.source,
        firstContactDate: c.firstContactDate.toISOString(),
        consultationBookingDate: c.consultationBookingDate?.toISOString() ?? null,
        consultationAttended: c.consultationAttended,
        consultationCancelled: c.consultationCancelled,
        isOnlineConsultation: c.isOnlineConsultation,
        consultationMasterName: c.consultationMasterName,
        masterId: c.masterId,
        masterDisplayName,
        consultationListComment: c.consultationListComment,
        consultationListOutcomeOverride: c.consultationListOutcomeOverride,
        signedUpForPaidService: c.signedUpForPaidService,
        signedUpForPaidServiceAfterConsultation: c.signedUpForPaidServiceAfterConsultation,
        rowColorKey,
        outcome,
      };
    });

    const summary = {
      total: mapped.length,
      realized: mapped.filter((c) => c.outcome === "realized").length,
      planned: mapped.filter((c) => c.outcome === "planned").length,
      cancelled: mapped.filter((c) => c.outcome === "cancelled").length,
      noShow: mapped.filter((c) => c.outcome === "no_show").length,
    };

    console.log("[stats/consultations] Завантажено список консультацій:", {
      monthKey,
      anchorDay,
      startOfMonthKyiv,
      endOfMonthKyiv,
      monthStartUtc: monthStartUtc.toISOString(),
      anchorEndUtc: anchorEndUtc.toISOString(),
      summary,
    });

    return NextResponse.json({
      ok: true,
      month: monthKey,
      anchorDay,
      startOfMonthKyiv,
      endOfMonthKyiv,
      summary,
      masters: masters.map((m) => ({ id: m.id, name: m.name })),
      todayKyiv,
      clients: mapped,
    });
  } catch (err) {
    console.error("[stats/consultations] Помилка:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
