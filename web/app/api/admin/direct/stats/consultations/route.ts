// web/app/api/admin/direct/stats/consultations/route.ts
// Список лідів (firstContactDate) і консультацій (consultationBookingDate) за місяць Kyiv.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKyivDayUtcBounds, getTodayKyiv, clientCountsTowardNewLeadsKpi } from "@/lib/direct-stats-config";
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

function isConsultationInMonth(
  client: { consultationBookingDate: Date | null; consultationDeletedInAltegio: boolean },
  monthStartUtc: Date,
  anchorEndUtc: Date
): boolean {
  if (client.consultationDeletedInAltegio || !client.consultationBookingDate) return false;
  const t = client.consultationBookingDate.getTime();
  return t >= monthStartUtc.getTime() && t < anchorEndUtc.getTime();
}

function isLeadInMonth(
  client: {
    firstContactDate: Date;
    includeInNewLeadsKpi: boolean;
    state: string | null;
    instagramUsername: string;
  },
  monthStartUtc: Date,
  anchorEndUtc: Date
): boolean {
  const t = client.firstContactDate.getTime();
  if (t < monthStartUtc.getTime() || t >= anchorEndUtc.getTime()) return false;
  return clientCountsTowardNewLeadsKpi(client);
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
        OR: [
          {
            consultationDeletedInAltegio: false,
            consultationBookingDate: {
              gte: monthStartUtc,
              lt: anchorEndUtc,
            },
          },
          {
            firstContactDate: {
              gte: monthStartUtc,
              lt: anchorEndUtc,
            },
            includeInNewLeadsKpi: true,
          },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        instagramUsername: true,
        source: true,
        state: true,
        includeInNewLeadsKpi: true,
        firstContactDate: true,
        consultationBookingDate: true,
        consultationDeletedInAltegio: true,
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
    });

    const filtered = clients.filter(
      (c) =>
        isConsultationInMonth(c, monthStartUtc, anchorEndUtc) ||
        isLeadInMonth(c, monthStartUtc, anchorEndUtc)
    );

    const mapped = filtered.map((c) => {
      const outcome = getConsultationOutcome(c);
      const masterNames = getMasterColumnNamesLikeTable(c as unknown as DirectClient, masters);
      const masterDisplayName = masterNames.length > 0 ? masterNames.join(", ") : null;
      const hasConsultationInMonth = isConsultationInMonth(c, monthStartUtc, anchorEndUtc);
      const isLeadOnly = !hasConsultationInMonth;
      const rowColorKey = getConsultationRowColorKey({
        consultationBookingDate: hasConsultationInMonth
          ? c.consultationBookingDate?.toISOString() ?? null
          : null,
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
        consultationBookingDate: hasConsultationInMonth
          ? c.consultationBookingDate?.toISOString() ?? null
          : null,
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
        isLeadOnly,
      };
    });

    mapped.sort((a, b) => {
      const sa = a.consultationBookingDate || a.firstContactDate;
      const sb = b.consultationBookingDate || b.firstContactDate;
      return sb.localeCompare(sa);
    });

    const withConsultation = mapped.filter((c) => !c.isLeadOnly);

    const summary = {
      newLeadsCount: filtered.filter((c) => isLeadInMonth(c, monthStartUtc, anchorEndUtc)).length,
      total: withConsultation.length,
      realized: withConsultation.filter((c) => c.outcome === "realized").length,
      planned: withConsultation.filter((c) => c.outcome === "planned").length,
      cancelled: withConsultation.filter((c) => c.outcome === "cancelled").length,
      noShow: withConsultation.filter((c) => c.outcome === "no_show").length,
      leadOnlyCount: mapped.filter((c) => c.isLeadOnly).length,
    };

    console.log("[stats/consultations] Завантажено лідів і консультацій:", {
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
