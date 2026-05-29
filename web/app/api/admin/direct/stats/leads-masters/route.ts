// web/app/api/admin/direct/stats/leads-masters/route.ts
// Розбивка «Ліди» по майстрах: консультації (факт), записи F4, конверсія — по місяцях і YTD.

import { NextRequest, NextResponse } from "next/server";
import { kvRead } from "@/lib/kv";
import { prisma } from "@/lib/prisma";
import { verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  pickNonAdminStaffFromGroup,
} from "@/lib/altegio/records-grouping";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

const EXCEL_DISPLAY_NAMES = ["Галина", "Олена", "Маряна", "Олександра"] as const;
const UNASSIGNED_ID = "unassigned";

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

function kyivMonthKeyFromISO(iso: string): string {
  const day = kyivDayFromISO(iso);
  return day ? day.slice(0, 7) : "";
}

function normalizeName(s: string | null | undefined): string {
  return (s || "").toString().trim().toLowerCase();
}

function firstTokenName(fullName: string | null | undefined): string {
  const n = normalizeName(fullName);
  if (!n) return "";
  return n.split(/\s+/)[0] || "";
}

function normalizeExcelMatchKey(name: string | null | undefined): string {
  return firstTokenName(name).replace(/['ʼ`]/g, "");
}

function monthKeysFromYearStart(throughMonth: string): string[] {
  const [yStr, mStr] = throughMonth.split("-");
  const y = Number(yStr);
  const endMo = Number(mStr);
  if (!y || !endMo || endMo < 1 || endMo > 12) return [throughMonth];
  const keys: string[] = [];
  for (let mo = 1; mo <= endMo; mo++) {
    keys.push(`${y}-${String(mo).padStart(2, "0")}`);
  }
  return keys;
}

type MasterCounts = {
  consultationsFact: number;
  recordsCount: number;
};

function emptyCounts(): MasterCounts {
  return { consultationsFact: 0, recordsCount: 0 };
}

function conversionPct(consultationsFact: number, recordsCount: number): number {
  return consultationsFact > 0 ? Math.round((recordsCount / consultationsFact) * 100) : 0;
}

type MasterRowOut = {
  displayName: string;
  masterId: string;
  consultationsFact: number;
  recordsCount: number;
  conversionPct: number;
};

function buildMasterRowsOutput(
  countsByMasterId: Map<string, MasterCounts>,
  rowsByMasterId: Map<string, { masterId: string; masterName: string }>
): MasterRowOut[] {
  const allRowsForExcel = [...rowsByMasterId.values()];
  const out: MasterRowOut[] = [];

  for (const excelName of EXCEL_DISPLAY_NAMES) {
    const key = normalizeExcelMatchKey(excelName);
    const matched = allRowsForExcel.find((row) => normalizeExcelMatchKey(row.masterName) === key);
    const masterId = matched?.masterId ?? UNASSIGNED_ID;
    const counts = countsByMasterId.get(masterId) ?? emptyCounts();
    out.push({
      displayName: excelName,
      masterId,
      consultationsFact: counts.consultationsFact,
      recordsCount: counts.recordsCount,
      conversionPct: conversionPct(counts.consultationsFact, counts.recordsCount),
    });
  }

  const unassigned = countsByMasterId.get(UNASSIGNED_ID) ?? emptyCounts();
  if (unassigned.consultationsFact > 0 || unassigned.recordsCount > 0) {
    out.push({
      displayName: "Без майстра",
      masterId: UNASSIGNED_ID,
      consultationsFact: unassigned.consultationsFact,
      recordsCount: unassigned.recordsCount,
      conversionPct: conversionPct(unassigned.consultationsFact, unassigned.recordsCount),
    });
  }

  return out;
}

function sumCountsMaps(maps: Map<string, MasterCounts>[]): Map<string, MasterCounts> {
  const result = new Map<string, MasterCounts>();
  for (const map of maps) {
    for (const [id, counts] of map.entries()) {
      const prev = result.get(id) ?? emptyCounts();
      result.set(id, {
        consultationsFact: prev.consultationsFact + counts.consultationsFact,
        recordsCount: prev.recordsCount + counts.recordsCount,
      });
    }
  }
  return result;
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

    const masters = await prisma.directMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true, role: true, altegioStaffId: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    const clients = await prisma.directClient.findMany({
      select: {
        id: true,
        visits: true,
        consultationBookingDate: true,
        consultationAttended: true,
        paidServiceRecordCreatedAt: true,
        paidServiceTotalCost: true,
        paidRecordsInHistoryCount: true,
        paidServiceIsRebooking: true,
        serviceMasterName: true,
        serviceMasterAltegioStaffId: true,
        altegioClientId: true,
      },
    });

    const rawItemsRecords = await kvRead.lrange("altegio:records:log", 0, 9999);
    const rawItemsWebhook = await kvRead.lrange("altegio:webhook:log", 0, 999);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);

    const masterIdByName = new Map<string, string>();
    const masterIdByFirst = new Map<string, string>();
    const masterIdByStaffId = new Map<number, string>();
    for (const m of masters) {
      const nm = normalizeName(m.name);
      if (nm) masterIdByName.set(nm, m.id);
      const first = firstTokenName(m.name);
      if (first) masterIdByFirst.set(first, m.id);
      if (typeof m.altegioStaffId === "number") masterIdByStaffId.set(m.altegioStaffId, m.id);
    }

    const rowsByMasterId = new Map<string, { masterId: string; masterName: string }>();
    for (const m of masters) {
      rowsByMasterId.set(m.id, { masterId: m.id, masterName: m.name });
    }
    rowsByMasterId.set(UNASSIGNED_ID, { masterId: UNASSIGNED_ID, masterName: "Без майстра" });

    const mapStaffToMasterId = (picked: { staffId: number | null; staffName: string } | null): string => {
      if (!picked) return UNASSIGNED_ID;
      if (picked.staffId != null && masterIdByStaffId.has(picked.staffId)) {
        return masterIdByStaffId.get(picked.staffId)!;
      }
      const full = normalizeName(picked.staffName);
      if (full && masterIdByName.has(full)) return masterIdByName.get(full)!;
      const first = firstTokenName(picked.staffName);
      if (first && masterIdByFirst.has(first)) return masterIdByFirst.get(first)!;
      return UNASSIGNED_ID;
    };

    const ensureCounts = (map: Map<string, MasterCounts>, id: string): MasterCounts => {
      if (!map.has(id)) map.set(id, emptyCounts());
      return map.get(id)!;
    };

    const countsByMonth = new Map<string, Map<string, MasterCounts>>();
    for (const month of monthKeys) {
      countsByMonth.set(month, new Map());
    }

    for (const c of clients) {
      const shouldIgnoreConsult = (c.visits ?? 0) >= 2;
      const groups = c.altegioClientId ? groupsByClient.get(c.altegioClientId) || [] : [];

      const fallbackMid = mapStaffToMasterId({
        staffId: c.serviceMasterAltegioStaffId ?? null,
        staffName: c.serviceMasterName || "",
      });

      for (const month of monthKeys) {
        const monthCounts = countsByMonth.get(month)!;
        const groupsInMonthAll = groups.filter((g: { kyivDay?: string }) => (g?.kyivDay || "").slice(0, 7) === month);
        const groupsInMonth = shouldIgnoreConsult
          ? groupsInMonthAll.filter((g: { groupType?: string }) => g?.groupType !== "consultation")
          : groupsInMonthAll;

        if (groupsInMonth.length) {
          for (const g of groupsInMonth) {
            const picked = pickNonAdminStaffFromGroup(g, "first");
            const mid = mapStaffToMasterId(picked);

            if (
              !shouldIgnoreConsult &&
              g.groupType === "consultation" &&
              g.datetime &&
              (g.attendanceStatus === "arrived" || g.attendance === 1 || g.attendance === 2)
            ) {
              ensureCounts(monthCounts, mid).consultationsFact += 1;
            }
          }
        } else if (
          !shouldIgnoreConsult &&
          c.consultationBookingDate &&
          kyivMonthKeyFromISO(c.consultationBookingDate.toISOString()) === month &&
          c.consultationAttended === true
        ) {
          ensureCounts(monthCounts, fallbackMid).consultationsFact += 1;
        }
      }

      // F4 записи — атрибуція по serviceMaster (один раз на клієнта, місяць з paidServiceRecordCreatedAt)
      const isF4Eligible =
        (c.paidServiceTotalCost ?? 0) > 0 &&
        (c.paidRecordsInHistoryCount ?? 0) === 0 &&
        c.paidServiceIsRebooking !== true &&
        c.paidServiceRecordCreatedAt != null;

      if (isF4Eligible && c.paidServiceRecordCreatedAt) {
        const f4Month = kyivMonthKeyFromISO(c.paidServiceRecordCreatedAt.toISOString());
        const monthCounts = countsByMonth.get(f4Month);
        if (monthCounts) {
          ensureCounts(monthCounts, fallbackMid).recordsCount += 1;
        }
      }
    }

    const monthsOut = monthKeys.map((monthKey) => {
      const counts = countsByMonth.get(monthKey)!;
      return {
        monthKey,
        masters: buildMasterRowsOutput(counts, rowsByMasterId),
      };
    });

    const ytdCounts = sumCountsMaps([...countsByMonth.values()]);
    const ytdMasters = buildMasterRowsOutput(ytdCounts, rowsByMasterId);
    let ytdConsultationsFact = 0;
    let ytdRecordsCount = 0;
    for (const counts of ytdCounts.values()) {
      ytdConsultationsFact += counts.consultationsFact;
      ytdRecordsCount += counts.recordsCount;
    }
    const ytdTotals = {
      consultationsFact: ytdConsultationsFact,
      recordsCount: ytdRecordsCount,
      conversionPct: conversionPct(ytdConsultationsFact, ytdRecordsCount),
    };

    console.log("[direct/stats/leads-masters] Підрахунок по майстрах:", {
      throughMonth,
      monthKeys,
      ytdTotals,
    });

    return NextResponse.json({
      ok: true,
      throughMonth,
      yearLabel,
      months: monthsOut,
      ytd: {
        masters: ytdMasters,
        totals: ytdTotals,
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
