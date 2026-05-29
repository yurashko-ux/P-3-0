// web/lib/direct-leads-masters-stats.ts
// Розбивка «Ліди» по майстрах — ті самі правила, що periodStats (consultationRealized) і F4 (record-created-counts).

import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { computePeriodStats } from "@/lib/direct-period-stats";

export const LEADS_MASTER_EXCEL_NAMES = ["Галина", "Олена", "Маряна", "Олександра"] as const;
export const LEADS_MASTER_OTHER_ID = "other";
export const LEADS_MASTER_UNASSIGNED_ID = "unassigned";

export type LeadsMasterClient = {
  id: string;
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
    if (!picked) return LEADS_MASTER_UNASSIGNED_ID;
    if (picked.staffId != null && masterIdByStaffId.has(picked.staffId)) {
      return masterIdByStaffId.get(picked.staffId)!;
    }
    const matchKey = normalizeLeadsMasterMatchKey(picked.staffName);
    if (matchKey && masterIdByMatchKey.has(matchKey)) return masterIdByMatchKey.get(matchKey)!;
    const full = normalizeName(picked.staffName);
    if (full && masterIdByName.has(full)) return masterIdByName.get(full)!;
    const first = firstTokenName(picked.staffName);
    if (first && masterIdByFirst.has(first)) return masterIdByFirst.get(first)!;
    return LEADS_MASTER_UNASSIGNED_ID;
  };

  return { masterIdSet, rowsByMasterId, mapStaffToMasterId };
}

/** Чи входить клієнт у «Консультації факт» (past) — як у computePeriodStats + getLeadsFooterVal. */
export function clientCountsTowardLeadsConsultFact(client: LeadsMasterClient, anchorKyiv: string): boolean {
  const { start } = getMonthBoundsFromAnchor(anchorKyiv);
  const consultDay = toKyivDay(client.consultationBookingDate);
  if (!consultDay || consultDay < start || consultDay > anchorKyiv) return false;
  return client.consultationAttended === true;
}

function resolveConsultMasterId(client: LeadsMasterClient, index: MasterIndex): string {
  const consultMasterId = (client.consultationMasterId || "").trim();
  if (consultMasterId && index.masterIdSet.has(consultMasterId)) {
    return consultMasterId;
  }
  if (client.consultationMasterName?.trim()) {
    const mid = index.mapStaffToMasterId({
      staffId: null,
      staffName: client.consultationMasterName.trim(),
    });
    if (mid !== LEADS_MASTER_UNASSIGNED_ID) return mid;
  }
  return index.mapStaffToMasterId({
    staffId: client.serviceMasterAltegioStaffId ?? null,
    staffName: client.serviceMasterName || "",
  });
}

function resolvePaidMasterId(client: LeadsMasterClient, index: MasterIndex): string {
  return index.mapStaffToMasterId({
    staffId: client.serviceMasterAltegioStaffId ?? null,
    staffName: client.serviceMasterName || "",
  });
}

function isF4Eligible(client: LeadsMasterClient): boolean {
  return (
    (client.paidServiceTotalCost ?? 0) > 0 &&
    (client.paidRecordsInHistoryCount ?? 0) === 0 &&
    client.paidServiceIsRebooking !== true &&
    client.paidServiceRecordCreatedAt != null
  );
}

function ensureCounts(map: Map<string, MasterCounts>, id: string): MasterCounts {
  if (!map.has(id)) map.set(id, emptyCounts());
  return map.get(id)!;
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

export function computeLeadsMasterCountsForAnchor(
  clients: LeadsMasterClient[],
  anchorKyiv: string,
  index: MasterIndex
): Map<string, MasterCounts> {
  const monthKey = anchorKyiv.slice(0, 7);
  const countsByMasterId = new Map<string, MasterCounts>();

  for (const c of clients) {
    if (clientCountsTowardLeadsConsultFact(c, anchorKyiv)) {
      const mid = resolveConsultMasterId(c, index);
      ensureCounts(countsByMasterId, mid).consultationsFact += 1;
    }

    if (isF4Eligible(c)) {
      const f4Day = toKyivDay(c.paidServiceRecordCreatedAt);
      if (f4Day.slice(0, 7) === monthKey) {
        const f4Mid = resolvePaidMasterId(c, index);
        ensureCounts(countsByMasterId, f4Mid).recordsCount += 1;
      }
    }
  }

  return countsByMasterId;
}

function bucketKeyForMasterId(
  masterId: string,
  index: MasterIndex
): string {
  if (masterId === LEADS_MASTER_UNASSIGNED_ID) return LEADS_MASTER_OTHER_ID;
  const row = index.rowsByMasterId.get(masterId);
  const matchKey = normalizeLeadsMasterMatchKey(row?.masterName);
  const excelKeys = LEADS_MASTER_EXCEL_NAMES.map((n) => normalizeLeadsMasterMatchKey(n));
  if (matchKey && excelKeys.includes(matchKey)) return matchKey;
  return LEADS_MASTER_OTHER_ID;
}

/** Агрегує по 4 іменам Excel + «Інше»; сума consultationsFact = periodStats past. */
export function buildLeadsMasterRowsOutput(
  countsByMasterId: Map<string, MasterCounts>,
  index: MasterIndex
): LeadsMasterRowOut[] {
  const buckets = new Map<string, MasterCounts>();
  for (const name of LEADS_MASTER_EXCEL_NAMES) {
    buckets.set(normalizeLeadsMasterMatchKey(name), emptyCounts());
  }
  buckets.set(LEADS_MASTER_OTHER_ID, emptyCounts());

  for (const [masterId, counts] of countsByMasterId.entries()) {
    const key = bucketKeyForMasterId(masterId, index);
    buckets.set(key, sumCounts(buckets.get(key) ?? emptyCounts(), counts));
  }

  const out: LeadsMasterRowOut[] = [];
  for (const excelName of LEADS_MASTER_EXCEL_NAMES) {
    const key = normalizeLeadsMasterMatchKey(excelName);
    const counts = buckets.get(key) ?? emptyCounts();
    out.push({
      displayName: excelName,
      masterId: key,
      consultationsFact: counts.consultationsFact,
      recordsCount: counts.recordsCount,
      conversionPct: conversionPct(counts.consultationsFact, counts.recordsCount),
    });
  }

  const other = buckets.get(LEADS_MASTER_OTHER_ID) ?? emptyCounts();
  if (other.consultationsFact > 0 || other.recordsCount > 0) {
    out.push({
      displayName: "Інше",
      masterId: LEADS_MASTER_OTHER_ID,
      consultationsFact: other.consultationsFact,
      recordsCount: other.recordsCount,
      conversionPct: conversionPct(other.consultationsFact, other.recordsCount),
    });
  }

  return out;
}

export function sumMasterCountsMaps(maps: Map<string, MasterCounts>[]): Map<string, MasterCounts> {
  const result = new Map<string, MasterCounts>();
  for (const map of maps) {
    for (const [id, counts] of map.entries()) {
      result.set(id, sumCounts(result.get(id) ?? emptyCounts(), counts));
    }
  }
  return result;
}

export function sumAllMasterCounts(countsByMasterId: Map<string, MasterCounts>): MasterCounts {
  let total = emptyCounts();
  for (const counts of countsByMasterId.values()) {
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
