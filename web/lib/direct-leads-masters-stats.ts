// web/lib/direct-leads-masters-stats.ts
// Розбивка «Ліди» по майстрах — periodStats (консультації факт) + F4; майстер з Altegio KV / consultationMasterName.

import {
  kyivDayFromISO,
  pickNonAdminStaffFromGroup,
  pickStaffFromGroup,
  isAdminStaffName,
  isUnknownStaffName,
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  type RecordGroup,
} from "@/lib/altegio/records-grouping";
import { computePeriodStats } from "@/lib/direct-period-stats";

export const LEADS_MASTER_EXCEL_NAMES = ["Галина", "Олена", "Маряна", "Олександра"] as const;

export type LeadsMasterClient = {
  id: string;
  altegioClientId?: number | null;
  consultationBookingDate: Date | string | null;
  consultationAttended: boolean | null;
  consultationCancelled?: boolean | null;
  consultationMasterId?: string | null;
  consultationMasterName?: string | null;
  paidServiceRecordCreatedAt: Date | string | null;
  paidServiceTotalCost: number | null;
  paidRecordsInHistoryCount: number | null;
  paidServiceIsRebooking: boolean | null;
  serviceMasterName: string | null;
  serviceMasterAltegioStaffId: number | null;
};

export type DirectMasterRef = {
  id: string;
  name: string;
  altegioStaffId: number | null;
};

export type MasterCounts = {
  consultationsFact: number;
  recordsCount: number;
};

export type LeadsMasterRowOut = {
  displayName: string;
  masterId: string;
  consultationsFact: number;
  recordsCount: number;
  conversionPct: number;
};

export type GroupsByAltegioClient = Map<number, RecordGroup[]>;

function toKyivDay(iso?: string | Date | null): string {
  if (!iso) return "";
  const s = String(iso).trim();
  if (!s) return "";
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d/.test(s) ? s.replace(/(\d{4}-\d{2}-\d{2})\s+/, "$1T") : s;
  return kyivDayFromISO(normalized);
}

function normalizeName(s: string | null | undefined): string {
  return (s || "").toString().trim().toLowerCase();
}

function firstTokenName(fullName: string | null | undefined): string {
  const n = normalizeName(fullName);
  if (!n) return "";
  return n.split(/\s+/)[0] || "";
}

export function normalizeLeadsMasterMatchKey(name: string | null | undefined): string {
  return firstTokenName(name).replace(/['ʼ`]/g, "");
}

const EXCEL_MATCH_KEYS = LEADS_MASTER_EXCEL_NAMES.map((n) => normalizeLeadsMasterMatchKey(n));

function getMonthBoundsFromAnchor(anchorKyiv: string): { start: string; end: string } {
  const [y, m] = anchorKyiv.split("-");
  const year = Number(y);
  const month = Number(m);
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${pad(lastDay)}` };
}

export function getLeadsMonthAnchorDate(monthKey: string, todayKyiv: string): string {
  if (monthKey === todayKyiv.slice(0, 7)) return todayKyiv;
  const [y, m] = monthKey.split("-");
  const year = Number(y);
  const month = Number(m);
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

function emptyCounts(): MasterCounts {
  return { consultationsFact: 0, recordsCount: 0 };
}

function conversionPct(consultationsFact: number, recordsCount: number): number {
  return consultationsFact > 0 ? Math.round((recordsCount / consultationsFact) * 100) : 0;
}

export type MasterIndex = {
  masterIdSet: Set<string>;
  rowsByMasterId: Map<string, { masterId: string; masterName: string }>;
  mapStaffToMasterId: (picked: { staffId: number | null; staffName: string } | null) => string;
};

export function buildMasterIndex(masters: DirectMasterRef[]): MasterIndex {
  const masterIdByName = new Map<string, string>();
  const masterIdByFirst = new Map<string, string>();
  const masterIdByMatchKey = new Map<string, string>();
  const masterIdByStaffId = new Map<number, string>();
  const masterIdSet = new Set<string>();
  const rowsByMasterId = new Map<string, { masterId: string; masterName: string }>();

  for (const m of masters) {
    masterIdSet.add(m.id);
    rowsByMasterId.set(m.id, { masterId: m.id, masterName: m.name });
    const nm = normalizeName(m.name);
    if (nm) masterIdByName.set(nm, m.id);
    const first = firstTokenName(m.name);
    if (first) masterIdByFirst.set(first, m.id);
    const matchKey = normalizeLeadsMasterMatchKey(m.name);
    if (matchKey) masterIdByMatchKey.set(matchKey, m.id);
    if (typeof m.altegioStaffId === "number") masterIdByStaffId.set(m.altegioStaffId, m.id);
  }

  const mapStaffToMasterId = (picked: { staffId: number | null; staffName: string } | null): string => {
    if (!picked?.staffName?.trim()) return "";
    if (picked.staffId != null && masterIdByStaffId.has(picked.staffId)) {
      return masterIdByStaffId.get(picked.staffId)!;
    }
    const matchKey = normalizeLeadsMasterMatchKey(picked.staffName);
    if (matchKey && masterIdByMatchKey.has(matchKey)) return masterIdByMatchKey.get(matchKey)!;
    const full = normalizeName(picked.staffName);
    if (full && masterIdByName.has(full)) return masterIdByName.get(full)!;
    const first = firstTokenName(picked.staffName);
    if (first && masterIdByFirst.has(first)) return masterIdByFirst.get(first)!;
    return "";
  };

  return { masterIdSet, rowsByMasterId, mapStaffToMasterId };
}

/** Ім'я з Altegio → ключ одного з 4 майстрів (галина/олена/маряна/олександра). */
export function mapStaffNameToExcelKey(staffName: string | null | undefined): string | null {
  const key = normalizeLeadsMasterMatchKey(staffName);
  if (!key) return null;
  return EXCEL_MATCH_KEYS.includes(key) ? key : null;
}

function pickStaffForConsultGroup(group: RecordGroup): { staffId: number | null; staffName: string } | null {
  const fromEvents =
    pickNonAdminStaffFromGroup(group, "first") ??
    pickStaffFromGroup(group, { mode: "first", allowAdmin: true });
  if (fromEvents?.staffName?.trim()) return fromEvents;

  const names = Array.isArray(group.staffNames) ? group.staffNames : [];
  const ids = Array.isArray(group.staffIds) ? group.staffIds : [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || "").trim();
    if (!name || isUnknownStaffName(name) || isAdminStaffName(name)) continue;
    return { staffId: ids[i] ?? null, staffName: name };
  }
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || "").trim();
    if (!name || isUnknownStaffName(name)) continue;
    return { staffId: ids[i] ?? null, staffName: name };
  }
  return null;
}

function isAttendedConsultGroup(g: RecordGroup): boolean {
  return (
    g.groupType === "consultation" &&
    (g.attendanceStatus === "arrived" || g.attendance === 1 || g.attendance === 2)
  );
}

/** Майстер консультації з KV: спочатку день візиту, потім будь-яка attended-консультація в місяці. */
function pickKvConsultStaff(
  groups: RecordGroup[] | undefined,
  consultDay: string,
  monthKey: string
): { staffId: number | null; staffName: string } | null {
  if (!groups?.length) return null;

  for (const g of groups) {
    if (!isAttendedConsultGroup(g)) continue;
    if (g.kyivDay !== consultDay) continue;
    const picked = pickStaffForConsultGroup(g);
    if (picked) return picked;
  }

  for (const g of groups) {
    if (!isAttendedConsultGroup(g)) continue;
    if ((g.kyivDay || "").slice(0, 7) !== monthKey) continue;
    const picked = pickStaffForConsultGroup(g);
    if (picked) return picked;
  }

  return null;
}

function pickKvPaidStaff(groups: RecordGroup[] | undefined, f4Day: string): { staffId: number | null; staffName: string } | null {
  if (!groups?.length) return null;
  for (const g of groups) {
    if (g.groupType !== "paid") continue;
    if (g.kyivDay !== f4Day && (g.kyivDay || "").slice(0, 7) !== f4Day.slice(0, 7)) continue;
    if (g.attendanceStatus !== "arrived" && g.attendance !== 1 && g.attendance !== 2) continue;
    const picked = pickStaffForConsultGroup(g);
    if (picked) return picked;
  }
  return null;
}

function staffPickToExcelKey(
  picked: { staffId: number | null; staffName: string } | null,
  index: MasterIndex
): string | null {
  if (!picked) return null;
  const byName = mapStaffNameToExcelKey(picked.staffName);
  if (byName) return byName;
  const masterId = index.mapStaffToMasterId(picked);
  if (masterId) {
    const row = index.rowsByMasterId.get(masterId);
    return mapStaffNameToExcelKey(row?.masterName);
  }
  return null;
}

/** Чи входить клієнт у «Консультації факт» (past) — як у computePeriodStats + getLeadsFooterVal. */
export function clientCountsTowardLeadsConsultFact(client: LeadsMasterClient, anchorKyiv: string): boolean {
  const { start } = getMonthBoundsFromAnchor(anchorKyiv);
  const consultDay = toKyivDay(client.consultationBookingDate);
  if (!consultDay || consultDay < start || consultDay > anchorKyiv) return false;
  return client.consultationAttended === true;
}

function resolveConsultExcelKey(
  client: LeadsMasterClient,
  consultDay: string,
  monthKey: string,
  groups: RecordGroup[] | undefined,
  index: MasterIndex
): string | null {
  const kv = pickKvConsultStaff(groups, consultDay, monthKey);
  const fromKv = staffPickToExcelKey(kv, index);
  if (fromKv) return fromKv;

  if (client.consultationMasterName?.trim()) {
    const k = mapStaffNameToExcelKey(client.consultationMasterName.trim());
    if (k) return k;
    const viaMaster = staffPickToExcelKey(
      { staffId: null, staffName: client.consultationMasterName.trim() },
      index
    );
    if (viaMaster) return viaMaster;
  }

  const consultMasterId = (client.consultationMasterId || "").trim();
  if (consultMasterId && index.masterIdSet.has(consultMasterId)) {
    const k = mapStaffNameToExcelKey(index.rowsByMasterId.get(consultMasterId)?.masterName);
    if (k) return k;
  }

  if (client.serviceMasterName?.trim() || client.serviceMasterAltegioStaffId != null) {
    const viaService = staffPickToExcelKey(
      {
        staffId: client.serviceMasterAltegioStaffId ?? null,
        staffName: client.serviceMasterName || "",
      },
      index
    );
    if (viaService) return viaService;
  }

  return null;
}

function resolvePaidExcelKey(
  client: LeadsMasterClient,
  f4Day: string,
  groups: RecordGroup[] | undefined,
  index: MasterIndex
): string | null {
  const kv = pickKvPaidStaff(groups, f4Day);
  const fromKv = staffPickToExcelKey(kv, index);
  if (fromKv) return fromKv;

  return staffPickToExcelKey(
    {
      staffId: client.serviceMasterAltegioStaffId ?? null,
      staffName: client.serviceMasterName || "",
    },
    index
  );
}

function isF4Eligible(client: LeadsMasterClient): boolean {
  return (
    (client.paidServiceTotalCost ?? 0) > 0 &&
    (client.paidRecordsInHistoryCount ?? 0) === 0 &&
    client.paidServiceIsRebooking !== true &&
    client.paidServiceRecordCreatedAt != null
  );
}

function ensureExcelCounts(map: Map<string, MasterCounts>, excelKey: string): MasterCounts {
  if (!map.has(excelKey)) map.set(excelKey, emptyCounts());
  return map.get(excelKey)!;
}

function initExcelCountsMap(): Map<string, MasterCounts> {
  const m = new Map<string, MasterCounts>();
  for (const key of EXCEL_MATCH_KEYS) {
    m.set(key, emptyCounts());
  }
  return m;
}

function sumCounts(a: MasterCounts, b: MasterCounts): MasterCounts {
  return {
    consultationsFact: a.consultationsFact + b.consultationsFact,
    recordsCount: a.recordsCount + b.recordsCount,
  };
}

/** Очікуваний «Консультації факт» з periodStats (past) для anchor-дня. */
export function getPeriodStatsConsultFactPast(clients: LeadsMasterClient[], anchorKyiv: string): number {
  const ps = computePeriodStats(clients, { todayKyiv: anchorKyiv });
  return ps.past.successfulConsultations ?? ps.past.consultationRealized ?? 0;
}

export function buildGroupsByAltegioClient(
  rawRecords: unknown[],
  rawWebhooks: unknown[]
): GroupsByAltegioClient {
  const normalizedEvents = normalizeRecordsLogItems([...rawRecords, ...rawWebhooks]);
  return groupRecordsByClientDay(normalizedEvents);
}

export function computeLeadsMasterCountsForAnchor(
  clients: LeadsMasterClient[],
  anchorKyiv: string,
  index: MasterIndex,
  groupsByClient: GroupsByAltegioClient
): { counts: Map<string, MasterCounts>; unmappedConsults: number; unmappedRecords: number } {
  const monthKey = anchorKyiv.slice(0, 7);
  const counts = initExcelCountsMap();
  let unmappedConsults = 0;
  let unmappedRecords = 0;

  for (const c of clients) {
    const groups =
      c.altegioClientId != null ? groupsByClient.get(Number(c.altegioClientId)) : undefined;

    if (clientCountsTowardLeadsConsultFact(c, anchorKyiv)) {
      const consultDay = toKyivDay(c.consultationBookingDate);
      const excelKey = resolveConsultExcelKey(c, consultDay, monthKey, groups, index);
      if (excelKey) {
        ensureExcelCounts(counts, excelKey).consultationsFact += 1;
      } else {
        unmappedConsults += 1;
        console.warn("[direct-leads-masters-stats] Консультація без майстра:", {
          clientId: c.id,
          altegioClientId: c.altegioClientId,
          consultDay,
          consultationMasterName: c.consultationMasterName,
          serviceMasterName: c.serviceMasterName,
        });
      }
    }

    if (isF4Eligible(c)) {
      const f4Day = toKyivDay(c.paidServiceRecordCreatedAt);
      if (f4Day.slice(0, 7) === monthKey) {
        const excelKey = resolvePaidExcelKey(c, f4Day, groups, index);
        if (excelKey) {
          ensureExcelCounts(counts, excelKey).recordsCount += 1;
        } else {
          unmappedRecords += 1;
        }
      }
    }
  }

  return { counts, unmappedConsults, unmappedRecords };
}

/** Лише 4 майстри — без «Інше». */
export function buildLeadsMasterRowsOutput(countsByExcelKey: Map<string, MasterCounts>): LeadsMasterRowOut[] {
  return LEADS_MASTER_EXCEL_NAMES.map((excelName) => {
    const key = normalizeLeadsMasterMatchKey(excelName);
    const counts = countsByExcelKey.get(key) ?? emptyCounts();
    return {
      displayName: excelName,
      masterId: key,
      consultationsFact: counts.consultationsFact,
      recordsCount: counts.recordsCount,
      conversionPct: conversionPct(counts.consultationsFact, counts.recordsCount),
    };
  });
}

export function sumMasterCountsMaps(maps: Map<string, MasterCounts>[]): Map<string, MasterCounts> {
  const result = initExcelCountsMap();
  for (const map of maps) {
    for (const [key, counts] of map.entries()) {
      if (result.has(key)) {
        result.set(key, sumCounts(result.get(key)!, counts));
      }
    }
  }
  return result;
}

export function sumAllMasterCounts(countsByExcelKey: Map<string, MasterCounts>): MasterCounts {
  let total = emptyCounts();
  for (const counts of countsByExcelKey.values()) {
    total = sumCounts(total, counts);
  }
  return total;
}

export function monthKeysFromYearStart(throughMonth: string): string[] {
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
