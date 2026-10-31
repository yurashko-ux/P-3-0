// web/app/api/admin/direct/stats/consultations/route.ts
// Список нових лідів і консультацій за місяць Kyiv — вкладка з блоку «Ліди».

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { enrichClientsWithChannelChatMeta } from "@/lib/direct-clients-channel-chat-meta";
import { prisma } from "@/lib/prisma";
import { isHiddenDirectMaster, loadHiddenStaffIndex } from "@/lib/team/hidden-staff";
import { getKyivDayUtcBounds, getTodayKyiv, clientCountsTowardNewLeadsKpi } from "@/lib/direct-stats-config";
import {
  startOfMonthKyivFromDay,
  endOfMonthKyivFromDay,
} from "@/lib/direct-f4-client-match";
import { getAuthContext, hasPermission, verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { getConsultationMasterColumnNames } from "@/lib/direct-master-column-names";
import type { DirectClient } from "@/lib/direct-types";
import { getConsultationRowColorKey } from "@/lib/consultation-list-styles";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
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

function hasConsultationBooking(client: {
  consultationBookingDate: Date | null;
  consultationDeletedInAltegio: boolean;
}): boolean {
  return !client.consultationDeletedInAltegio && !!client.consultationBookingDate;
}

function isPlaceholderInstagramUsername(username: string): boolean {
  const u = String(username || "");
  return (
    u.startsWith("binotel_") ||
    u.startsWith("missing_instagram_") ||
    u.startsWith("no_instagram_") ||
    u.startsWith("altegio_") ||
    u.startsWith("__no_ig__")
  );
}

/**
 * Лід у місяці firstContact: KPI-прапорець або реальний IG, якого з KPI зняли після запису консультації в Altegio.
 * Без цього бронювання «на наступний місяць» ховає лід з вкладки Ліди в місяці першого контакту.
 */
function isNewLeadInMonth(
  client: {
    firstContactDate: Date;
    includeInNewLeadsKpi: boolean;
    state: string | null;
    instagramUsername: string;
    consultationBookingDate?: Date | null;
    consultationDeletedInAltegio?: boolean;
  },
  monthStartUtc: Date,
  anchorEndUtc: Date
): boolean {
  const t = client.firstContactDate.getTime();
  if (t < monthStartUtc.getTime() || t >= anchorEndUtc.getTime()) return false;
  if (clientCountsTowardNewLeadsKpi(client)) return true;
  // Захист: після Altegio merge kpi інколи false, але лід з реальним IG і записом консультації має лишатись у Лідах.
  if (client.state === "binotel-lead") return false;
  if (isPlaceholderInstagramUsername(client.instagramUsername)) return false;
  if (client.consultationDeletedInAltegio) return false;
  return !!client.consultationBookingDate;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const auth = await getAuthContext(req);
  if (
    auth?.type === "user" &&
    !hasPermission(auth.permissions, "leadsSection") &&
    !hasPermission(auth.permissions, "statsSection")
  ) {
    return NextResponse.json({ ok: false, error: "Немає доступу до розділу Ліди" }, { status: 403 });
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
      select: { id: true, name: true, altegioStaffId: true },
    });
    const hiddenStaff = await loadHiddenStaffIndex();
    const visibleMasters = masters.filter((m) => !isHiddenDirectMaster(hiddenStaff, m));
    const leadSources = await prisma.leadSource.findMany({
      select: { code: true, mark: true, name: true },
    });
    const sourceMarkByCode = new Map(leadSources.map((s) => [s.code, s.mark]));
    const sourceNameByCode = new Map(leadSources.map((s) => [s.code, s.name]));

    // Id через сирий SQL: findMany на проді інколи відстає від Direct після #6
    // (лід є в /clients?search=, а в /stats/consultations ще немає).
    const consultationSelect = {
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
      phone: true,
      chatStatusId: true,
      chatStatusSetAt: true,
      chatStatusCheckedAt: true,
      leadAgency: true,
      leadAdId: true,
    } as const;

    const [consultationIdRows, newLeadIdRows] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM direct_clients
        WHERE "consultationDeletedInAltegio" = false
          AND "consultationBookingDate" IS NOT NULL
          AND "consultationBookingDate" >= ${monthStartUtc}
          AND "consultationBookingDate" < ${anchorEndUtc}
      `,
      prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM direct_clients
        WHERE "firstContactDate" >= ${monthStartUtc}
          AND "firstContactDate" < ${anchorEndUtc}
          AND (
            "includeInNewLeadsKpi" = true
            OR (
              -- Реальний IG-лід, знятий з KPI після запису консультації (має лишатись у Лідах у місяці firstContact)
              "consultationBookingDate" IS NOT NULL
              AND "consultationDeletedInAltegio" = false
              AND COALESCE(state, '') <> 'binotel-lead'
              AND "instagramUsername" !~ '^(binotel_|missing_instagram_|no_instagram_|altegio_|__no_ig__)'
            )
          )
      `,
    ]);

    const idSet = new Set<string>();
    for (const row of consultationIdRows) idSet.add(row.id);
    for (const row of newLeadIdRows) idSet.add(row.id);
    const allIds = Array.from(idSet);

    let clients =
      allIds.length === 0
        ? []
        : await prisma.directClient.findMany({
            where: { id: { in: allIds } },
            select: consultationSelect,
          });

    if (clients.length < allIds.length) {
      const have = new Set(clients.map((row) => row.id));
      const missing = allIds.filter((id) => !have.has(id));
      console.warn("[stats/consultations] findMany не повернув id зі SQL", {
        missing: missing.length,
        sample: missing.slice(0, 8),
      });
      for (const id of missing) {
        const row = await prisma.directClient.findUnique({
          where: { id },
          select: consultationSelect,
        });
        if (row) clients.push(row);
      }
    }

    console.log("[stats/consultations] Вибірка", {
      consultationIds: consultationIdRows.length,
      newLeadIds: newLeadIdRows.length,
      mergedIds: allIds.length,
      loaded: clients.length,
      monthStartUtc: monthStartUtc.toISOString(),
      anchorEndUtc: anchorEndUtc.toISOString(),
    });

    const filtered = clients.filter(
      (c) =>
        isNewLeadInMonth(c, monthStartUtc, anchorEndUtc) ||
        isConsultationInMonth(c, monthStartUtc, anchorEndUtc)
    );

    type MappedConsultationRow = {
      id: string;
      rowKey: string;
      firstName: string | null;
      lastName: string | null;
      instagramUsername: string;
      source: string | null;
      firstContactDate: string;
      consultationBookingDate: string | null;
      consultationAttended: boolean | null;
      consultationCancelled: boolean;
      isOnlineConsultation: boolean | null;
      consultationMasterName: string | null;
      masterId: string | null;
      masterDisplayName: string | null;
      consultationListComment: string | null;
      consultationListOutcomeOverride: string | null;
      phone: string | null;
      signedUpForPaidService: boolean | null;
      signedUpForPaidServiceAfterConsultation: boolean | null;
      rowColorKey: ReturnType<typeof getConsultationRowColorKey>;
      outcome: ConsultationOutcome;
      isLeadOnly: boolean;
      /** Чи входить у summary консультацій місяця (майбутня копія поза вікном — ні). */
      countsTowardConsultationSummary: boolean;
      chatStatusId: string | null;
      chatStatusSetAt: Date | null;
      chatStatusCheckedAt: Date | null;
      leadAgency: string | null;
      leadAdId: string | null;
      sourceMark: string | null;
      sourceName: string | null;
    };

    const mapped: MappedConsultationRow[] = [];

    for (const c of filtered) {
      const outcome = getConsultationOutcome(c);
      const masterNames = getConsultationMasterColumnNames(c as unknown as DirectClient);
      const masterDisplayName = masterNames.length > 0 ? masterNames.join(", ") : null;
      const inMonth = isConsultationInMonth(c, monthStartUtc, anchorEndUtc);
      const booked = hasConsultationBooking(c);
      const asLead = isNewLeadInMonth(c, monthStartUtc, anchorEndUtc);
      const firstContactIso = c.firstContactDate.toISOString();
      const bookingIso = booked ? c.consultationBookingDate!.toISOString() : null;
      const contactDay = kyivDayFromISO(firstContactIso) || "";
      const bookingDay = bookingIso ? kyivDayFromISO(bookingIso) || "" : "";
      // Різні календарні дні Kyiv → лід лишається в дні контакту + копія на день консультації.
      const splitLeadAndConsultation = Boolean(asLead && booked && contactDay && bookingDay && contactDay !== bookingDay);

      const base = {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        instagramUsername: c.instagramUsername,
        source: c.source,
        firstContactDate: firstContactIso,
        consultationAttended: c.consultationAttended,
        consultationCancelled: c.consultationCancelled,
        isOnlineConsultation: c.isOnlineConsultation,
        consultationMasterName: c.consultationMasterName,
        masterId: c.masterId,
        masterDisplayName,
        consultationListComment: c.consultationListComment,
        consultationListOutcomeOverride: c.consultationListOutcomeOverride,
        phone: c.phone ?? null,
        signedUpForPaidService: c.signedUpForPaidService,
        signedUpForPaidServiceAfterConsultation: c.signedUpForPaidServiceAfterConsultation,
        outcome,
        chatStatusId: c.chatStatusId,
        chatStatusSetAt: c.chatStatusSetAt,
        chatStatusCheckedAt: c.chatStatusCheckedAt,
        leadAgency: c.leadAgency,
        leadAdId: c.leadAdId,
        sourceMark: c.leadAgency ? sourceMarkByCode.get(c.leadAgency) || null : null,
        sourceName: c.leadAgency ? sourceNameByCode.get(c.leadAgency) || null : null,
      };

      const pushRow = (opts: {
        rowKey: string;
        isLeadOnly: boolean;
        consultationBookingDate: string | null;
        countsTowardConsultationSummary: boolean;
      }) => {
        const rowColorKey = getConsultationRowColorKey({
          consultationBookingDate: opts.isLeadOnly ? null : opts.consultationBookingDate,
          outcome,
          consultationListOutcomeOverride: c.consultationListOutcomeOverride,
          signedUpForPaidService: c.signedUpForPaidService,
          signedUpForPaidServiceAfterConsultation: c.signedUpForPaidServiceAfterConsultation,
        });
        mapped.push({
          ...base,
          rowKey: opts.rowKey,
          isLeadOnly: opts.isLeadOnly,
          consultationBookingDate: opts.consultationBookingDate,
          countsTowardConsultationSummary: opts.countsTowardConsultationSummary,
          rowColorKey,
        });
      };

      if (splitLeadAndConsultation) {
        // 1) Лід у дні першого контакту — не забираємо.
        pushRow({
          rowKey: `${c.id}__lead`,
          isLeadOnly: true,
          consultationBookingDate: bookingIso,
          countsTowardConsultationSummary: false,
        });
        // 2) Копія на дату консультації одразу після створення запису.
        // У summary місяця — лише якщо бронювання в поточному вікні; інакше лише показ (напр. 03.11 у жовтні).
        pushRow({
          rowKey: `${c.id}__consultation`,
          isLeadOnly: false,
          consultationBookingDate: bookingIso,
          countsTowardConsultationSummary: inMonth,
        });
      } else if (asLead && !inMonth) {
        // Лід без консультації в цьому місяці (або без запису взагалі).
        pushRow({
          rowKey: `${c.id}__lead`,
          isLeadOnly: true,
          consultationBookingDate: bookingIso,
          countsTowardConsultationSummary: false,
        });
      } else {
        // Консультація в місяці (той самий день що контакт, або лід з минулого місяця).
        pushRow({
          rowKey: `${c.id}__consultation`,
          isLeadOnly: !inMonth,
          consultationBookingDate: bookingIso,
          countsTowardConsultationSummary: inMonth,
        });
      }
    }

    mapped.sort((a, b) => {
      const sa = a.isLeadOnly ? a.firstContactDate : a.consultationBookingDate || a.firstContactDate;
      const sb = b.isLeadOnly ? b.firstContactDate : b.consultationBookingDate || b.firstContactDate;
      return sb.localeCompare(sa);
    });

    // Сирий SQL по id: великий OR-findMany на проді інколи віддає leadAgency=null,
    // хоча findUnique / Direct по тому ж id бачать agency_2 (Алла, Тетяна — серце в Direct є).
    if (mapped.length > 0) {
      const ids = mapped.map((m) => m.id);
      const agencyRows = await prisma.$queryRaw<
        Array<{ id: string; leadAgency: string | null; leadAdId: string | null }>
      >`
        SELECT id, "leadAgency", "leadAdId"
        FROM direct_clients
        WHERE id IN (${Prisma.join(ids)})
      `;
      const agencyById = new Map(agencyRows.map((r) => [r.id, r]));
      let patched = 0;
      for (const row of mapped) {
        const fresh = agencyById.get(row.id);
        if (!fresh) continue;
        // Порожній SQL не затирає вже прочитане джерело: великий IN інколи віддає null.
        const nextAgency = fresh.leadAgency || row.leadAgency;
        const nextAdId = fresh.leadAdId || row.leadAdId;
        if (row.leadAgency !== nextAgency || row.leadAdId !== nextAdId) {
          if (row.leadAgency !== nextAgency) {
            console.warn("[stats/consultations] leadAgency розійшовся з SQL по id", {
              id: row.id,
              username: row.instagramUsername,
              fromBigQuery: row.leadAgency,
              fromSql: fresh.leadAgency,
            });
          }
          row.leadAgency = nextAgency;
          row.leadAdId = nextAdId;
          row.sourceMark = nextAgency ? sourceMarkByCode.get(nextAgency) || null : null;
          row.sourceName = nextAgency ? sourceNameByCode.get(nextAgency) || null : null;
          patched += 1;
        }
      }
      if (patched > 0) {
        console.log("[stats/consultations] Підтягнуто leadAgency/leadAdId з SQL:", patched);
      }
    }

    // Призначене оголошення — джерело правди для знака біля хмарки.
    // Великий список місяця інколи лишає leadAgency порожнім (naqwe_: ad вже Наталя, на хмарці «?»).
    const adLinks = await prisma.leadSourceAdId.findMany({
      where: { sourceCode: { not: null } },
      select: { adId: true, sourceCode: true },
    });
    const sourceByAdId = new Map(
      adLinks.flatMap((link) => (link.sourceCode ? [[link.adId, link.sourceCode] as const] : []))
    );
    let fromAds = 0;
    for (const row of mapped) {
      const fromAd = row.leadAdId ? sourceByAdId.get(row.leadAdId) : undefined;
      if (!fromAd || row.leadAgency === fromAd) continue;
      row.leadAgency = fromAd;
      row.sourceMark = sourceMarkByCode.get(fromAd) || null;
      row.sourceName = sourceNameByCode.get(fromAd) || null;
      fromAds += 1;
    }
    if (fromAds > 0) {
      console.log("[stats/consultations] Знак хмарки з призначеного ad_id:", fromAds);
    }

    const withChat = await enrichClientsWithChannelChatMeta(mapped, "instagram");

    // Майбутня копія поза вікном місяця (напр. 03.11 у жовтневому списку) — лише показ, не в summary.
    const withConsultationInMonth = mapped.filter((c) => c.countsTowardConsultationSummary);

    const summary = {
      newLeadsCount: filtered.filter((c) => isNewLeadInMonth(c, monthStartUtc, anchorEndUtc)).length,
      total: withConsultationInMonth.length,
      realized: withConsultationInMonth.filter((c) => c.outcome === "realized").length,
      planned: withConsultationInMonth.filter((c) => c.outcome === "planned").length,
      cancelled: withConsultationInMonth.filter((c) => c.outcome === "cancelled").length,
      noShow: withConsultationInMonth.filter((c) => c.outcome === "no_show").length,
      leadOnlyCount: mapped.filter((c) => c.isLeadOnly).length,
    };

    console.log("[stats/consultations] Завантажено нових лідів і консультацій:", {
      monthKey,
      anchorDay,
      startOfMonthKyiv,
      endOfMonthKyiv,
      monthStartUtc: monthStartUtc.toISOString(),
      anchorEndUtc: anchorEndUtc.toISOString(),
      summary,
    });

    return NextResponse.json(
      {
        ok: true,
        month: monthKey,
        anchorDay,
        startOfMonthKyiv,
        endOfMonthKyiv,
        summary,
        masters: visibleMasters.map((m) => ({ id: m.id, name: m.name })),
        todayKyiv,
        clients: withChat,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
          "CDN-Cache-Control": "no-store",
          "Vercel-CDN-Cache-Control": "no-store",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
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
