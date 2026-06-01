// web/lib/direct-leads-masters-stats.ts
// Розбивка «Ліди» по майстрах — periodStats (консультації факт) + F4.
// Атрибуція консультації: consultationMasterName з БД; KV «Історія» лише якщо в БД порожньо.

import {
  kyivDayFromISO,
  pickClosestPaidGroup,
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  pickConsultStaffFromGroup,
  type RecordGroup,
} from "@/lib/altegio/records-grouping";
import {
  namesFromMasterDisplay,
  needsConsultationMasterResolve,
  resolveConsultationMasterFromKvGroups,
} from "@/lib/direct-consultation-master-sync";
import { computePeriodStats } from "@/lib/direct-period-stats";

export const LEADS_MASTER_EXCEL_NAMES = ["Галина", "Олена", "Маряна", "Олександра"] as const;
/** Префікс ключа для майстра з KV / Altegio (не один з 4 консультантів, напр. адмін онлайн). */
export const LEADS_STAFF_KEY_PREFIX = "staff:";
/** Рядок «Інші» — консультації без майстра ні в БД, ні в KV «Історія». */
export const LEADS_OTHER_MASTER_ID = "other";

export type LeadsMasterClient = {
  id: string;
  altegioClientId?: number | null;
  consultationBookingDate: Date | string | null;
  consultationDate?: Date | string | null;
  consultationAttended: boolean | null;
  consultationCancelled?: boolean | null;
  consultationMasterId?: string | null;
  consultationMasterName?: string | null;
  /** Відповідальний майстер з ліда (DirectMaster) */
  masterId?: string | null;
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
  consultFactClientIds: string[];
};

export type LeadsMasterRowOut = {
  displayName: string;
  masterId: string;
  consultationsFact: number;
  recordsCount: number;
  conversionPct: number;
  clientIds?: string[];
  isOther?: boolean;
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

export function isLeadsStaffAttributionKey(key: string): boolean {
  return key.startsWith(LEADS_STAFF_KEY_PREFIX);
}

/** Ключ атрибуції для імені з Altegio (адмін, онлайн тощо). */
export function toStaffAttributionKey(staffName: string | null | undefined): string | null {
  const matchKey = normalizeLeadsMasterMatchKey(staffName);
  if (!matchKey) return null;
  if (EXCEL_MATCH_KEYS.includes(matchKey)) return matchKey;
  return `${LEADS_STAFF_KEY_PREFIX}${matchKey}`;
}

function staffKeyToDisplayName(key: string): string {
  if (!isLeadsStaffAttributionKey(key)) return key;
  const token = key.slice(LEADS_STAFF_KEY_PREFIX.length);
  if (!token) return key;
  return token.charAt(0).toUpperCase() + token.slice(1);
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
  return { consultationsFact: 0, recordsCount: 0, consultFactClientIds: [] };
}

function mergeConsultFactClientIds(a: string[], b: string[]): string[] {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  return [...new Set([...a, ...b])];
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

function pickStaffForPaidGroup(group: RecordGroup): { staffId: number | null; staffName: string } | null {
  return pickConsultStaffFromGroup(group);
}

function isAttendedConsultGroup(g: RecordGroup): boolean {
  return (
    g.groupType === "consultation" &&
    (g.attendanceStatus === "arrived" || g.attendance === 1 || g.attendance === 2)
  );
}

function pickKvConsultStaff(
  groups: RecordGroup[] | undefined,
  consultBookingIso: string | null | undefined,
  consultationDateIso?: string | null | undefined
): { staffId: number | null; staffName: string } | null {
  if (!groups?.length) return null;
  const pick = resolveConsultationMasterFromKvGroups(
    groups,
    consultBookingIso,
    consultationDateIso
  );
  if (pick?.displayName?.trim()) {
    return { staffId: pick.staffId, staffName: pick.displayName.trim() };
  }
  return null;
}

function pickKvPaidStaff(
  groups: RecordGroup[] | undefined,
  f4Day: string,
  paidBookingIso: string | null | undefined
): { staffId: number | null; staffName: string } | null {
  if (!groups?.length) return null;
  for (const g of groups) {
    if (g.groupType !== "paid") continue;
    if (g.kyivDay !== f4Day && (g.kyivDay || "").slice(0, 7) !== f4Day.slice(0, 7)) continue;
    if (g.attendanceStatus !== "arrived" && g.attendance !== 1 && g.attendance !== 2) continue;
    const picked = pickStaffForPaidGroup(g);
    if (picked) return picked;
  }
  const closest = pickClosestPaidGroup(groups, paidBookingIso);
  if (closest) {
    const picked = pickStaffForPaidGroup(closest);
    if (picked) return picked;
  }
  return null;
}

function masterIdToAttributionKey(masterId: string | null | undefined, index: MasterIndex): string | null {
  const id = (masterId || "").trim();
  if (!id || !index.masterIdSet.has(id)) return null;
  const masterName = index.rowsByMasterId.get(id)?.masterName || "";
  if (!masterName.trim()) return null;
  const byExcel = mapStaffNameToExcelKey(masterName);
  if (byExcel) return byExcel;
  return toStaffAttributionKey(masterName);
}

/** @deprecated alias */
function masterIdToExcelKey(masterId: string | null | undefined, index: MasterIndex): string | null {
  return masterIdToAttributionKey(masterId, index);
}

function staffPickToAttributionKey(
  picked: { staffId: number | null; staffName: string } | null,
  index: MasterIndex
): string | null {
  if (!picked?.staffName?.trim()) return null;
  const byExcel = mapStaffNameToExcelKey(picked.staffName);
  if (byExcel) return byExcel;
  const masterId = index.mapStaffToMasterId(picked);
  if (masterId && index.masterIdSet.has(masterId)) {
    const linkedName = index.rowsByMasterId.get(masterId)?.masterName || "";
    if (linkedName.trim()) {
      const linkedExcel = mapStaffNameToExcelKey(linkedName);
      if (linkedExcel) return linkedExcel;
      const linkedStaff = toStaffAttributionKey(linkedName);
      if (linkedStaff) return linkedStaff;
    }
  }
  return toStaffAttributionKey(picked.staffName);
}

/** @deprecated */
function staffPickToExcelKey(
  picked: { staffId: number | null; staffName: string } | null,
  index: MasterIndex
): string | null {
  return staffPickToAttributionKey(picked, index);
}

/** «Головний (Інший1, Інший2)» → список імен; спочатку з дужок (часто консультант). */
function namesFromMasterDisplayLocal(raw: string | null | undefined): string[] {
  return namesFromMasterDisplay(raw);
}

function resolveNamesToAttributionKey(names: string[], index: MasterIndex): string | null {
  for (const name of names) {
    const key = staffPickToAttributionKey({ staffId: null, staffName: name }, index);
    if (key) return key;
  }
  return null;
}

/** @deprecated */
function resolveNamesToExcelKey(names: string[], index: MasterIndex): string | null {
  return resolveNamesToAttributionKey(names, index);
}

/** Чи входить клієнт у «Консультації факт» (past) — як у computePeriodStats + getLeadsFooterVal. */
export function clientCountsTowardLeadsConsultFact(client: LeadsMasterClient, anchorKyiv: string): boolean {
  const { start } = getMonthBoundsFromAnchor(anchorKyiv);
  const consultDay = toKyivDay(client.consultationBookingDate);
  if (!consultDay || consultDay < start || consultDay > anchorKyiv) return false;
  return client.consultationAttended === true;
}

function resolveConsultAttributionKey(
  client: LeadsMasterClient,
  consultDay: string,
  monthKey: string,
  groups: RecordGroup[] | undefined,
  index: MasterIndex
): string | null {
  const consultBookingIso =
    client.consultationBookingDate != null ? String(client.consultationBookingDate) : null;
  const consultationDateIso =
    client.consultationDate != null ? String(client.consultationDate) : null;

  // 1. БД — узгоджено з колонкою «Майстер консультацій» у Direct
  const fromConsultName = resolveNamesToAttributionKey(
    namesFromMasterDisplayLocal(client.consultationMasterName),
    index
  );
  if (fromConsultName) return fromConsultName;

  // 2. consultationMasterId (DirectMaster), якщо імʼя в БД порожнє
  const fromConsultMasterId = masterIdToAttributionKey(client.consultationMasterId, index);
  if (fromConsultMasterId) return fromConsultMasterId;

  const consultRaw = (client.consultationMasterName || "").trim();
  if (consultRaw) {
    const fromRaw = staffPickToAttributionKey({ staffId: null, staffName: consultRaw }, index);
    if (fromRaw) return fromRaw;
  }

  // 3. KV «Історія» — лише якщо в БД немає імені або воно не консультант (не перезаписуємо БД)
  if (!consultRaw || needsConsultationMasterResolve(consultRaw)) {
    const kv = pickKvConsultStaff(groups, consultBookingIso, consultationDateIso);
    const fromKv = staffPickToAttributionKey(kv, index);
    if (fromKv) return fromKv;
  }

  return null;
}

/** @deprecated */
function resolveConsultExcelKey(
  client: LeadsMasterClient,
  consultDay: string,
  monthKey: string,
  groups: RecordGroup[] | undefined,
  index: MasterIndex
): string | null {
  return resolveConsultAttributionKey(client, consultDay, monthKey, groups, index);
}

function resolvePaidAttributionKey(
  client: LeadsMasterClient,
  f4Day: string,
  groups: RecordGroup[] | undefined,
  index: MasterIndex
): string | null {
  const paidBookingIso =
    client.paidServiceRecordCreatedAt != null ? String(client.paidServiceRecordCreatedAt) : null;

  const kv = pickKvPaidStaff(groups, f4Day, paidBookingIso);
  const fromKv = staffPickToAttributionKey(kv, index);
  if (fromKv) return fromKv;

  const fromService = staffPickToAttributionKey(
    {
      staffId: client.serviceMasterAltegioStaffId ?? null,
      staffName: client.serviceMasterName || "",
    },
    index
  );
  if (fromService) return fromService;

  const fromConsultName = resolveNamesToAttributionKey(
    namesFromMasterDisplayLocal(client.consultationMasterName),
    index
  );
  if (fromConsultName) return fromConsultName;

  const fromLead = masterIdToExcelKey(client.masterId, index);
  if (fromLead) return fromLead;

  const leadRow = client.masterId ? index.rowsByMasterId.get(client.masterId) : undefined;
  if (leadRow?.masterName?.trim()) {
    return staffPickToAttributionKey({ staffId: null, staffName: leadRow.masterName }, index);
  }

  return null;
}

/** @deprecated */
function resolvePaidExcelKey(
  client: LeadsMasterClient,
  f4Day: string,
  groups: RecordGroup[] | undefined,
  index: MasterIndex
): string | null {
  return resolvePaidAttributionKey(client, f4Day, groups, index);
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
    consultFactClientIds: mergeConsultFactClientIds(a.consultFactClientIds, b.consultFactClientIds),
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
): {
  counts: Map<string, MasterCounts>;
  unmappedConsults: number;
  unmappedRecords: number;
  unmappedConsultClientIds: string[];
  consultFactClientIds: string[];
} {
  const monthKey = anchorKyiv.slice(0, 7);
  const counts = initExcelCountsMap();
  let unmappedConsults = 0;
  let unmappedRecords = 0;
  const unmappedConsultClientIds: string[] = [];
  const consultFactClientIds: string[] = [];

  for (const c of clients) {
    const groups =
      c.altegioClientId != null ? groupsByClient.get(Number(c.altegioClientId)) : undefined;

    if (clientCountsTowardLeadsConsultFact(c, anchorKyiv)) {
      consultFactClientIds.push(c.id);
      const consultDay = toKyivDay(c.consultationBookingDate);
      const attrKey = resolveConsultAttributionKey(c, consultDay, monthKey, groups, index);
      if (attrKey) {
        const bucket = ensureExcelCounts(counts, attrKey);
        bucket.consultationsFact += 1;
        bucket.consultFactClientIds.push(c.id);
      } else {
        unmappedConsults += 1;
        unmappedConsultClientIds.push(c.id);
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
        const attrKey = resolvePaidAttributionKey(c, f4Day, groups, index);
        if (attrKey) {
          ensureExcelCounts(counts, attrKey).recordsCount += 1;
        } else {
          unmappedRecords += 1;
        }
      }
    }
  }

  return { counts, unmappedConsults, unmappedRecords, unmappedConsultClientIds, consultFactClientIds };
}

/** 4 майстри з Excel + додаткові рядки (адміни / онлайн з KV). */
export function buildLeadsMasterRowsFromCounts(
  countsByKey: Map<string, MasterCounts>
): LeadsMasterRowOut[] {
  const rows = buildLeadsMasterRowsOutput(countsByKey);

  const dynamicKeys = [...countsByKey.keys()]
    .filter((k) => !EXCEL_MATCH_KEYS.includes(k))
    .filter((k) => {
      const c = countsByKey.get(k)!;
      return c.consultationsFact > 0 || c.recordsCount > 0;
    })
    .sort((a, b) => staffKeyToDisplayName(a).localeCompare(staffKeyToDisplayName(b), "uk"));

  for (const key of dynamicKeys) {
    const counts = countsByKey.get(key) ?? emptyCounts();
    rows.push({
      displayName: staffKeyToDisplayName(key),
      masterId: key,
      consultationsFact: counts.consultationsFact,
      recordsCount: counts.recordsCount,
      conversionPct: conversionPct(counts.consultationsFact, counts.recordsCount),
      clientIds: counts.consultFactClientIds,
    });
  }

  return rows;
}

/** 4 майстри з Excel. */
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
      clientIds: counts.consultFactClientIds,
    };
  });
}

/** Рядок «Інші» — консультації без атрибуції майстра. */
export function buildLeadsOtherMasterRow(
  unmappedConsults: number,
  unmappedRecords: number,
  clientIds: string[]
): LeadsMasterRowOut {
  return {
    displayName: "Інші",
    masterId: LEADS_OTHER_MASTER_ID,
    consultationsFact: unmappedConsults,
    recordsCount: unmappedRecords,
    conversionPct: conversionPct(unmappedConsults, unmappedRecords),
    clientIds,
    isOther: true,
  };
}

export function buildLeadsMasterRowsWithOther(
  countsByExcelKey: Map<string, MasterCounts>,
  unmappedConsults: number,
  unmappedRecords: number,
  clientIds: string[]
): LeadsMasterRowOut[] {
  const rows = buildLeadsMasterRowsFromCounts(countsByExcelKey);
  if (unmappedConsults <= 0 && unmappedRecords <= 0) {
    return rows;
  }
  return [...rows, buildLeadsOtherMasterRow(unmappedConsults, unmappedRecords, clientIds)];
}

export function sumMasterCountsMaps(maps: Map<string, MasterCounts>[]): Map<string, MasterCounts> {
  const result = initExcelCountsMap();
  for (const map of maps) {
    for (const [key, counts] of map.entries()) {
      const prev = result.get(key) ?? emptyCounts();
      result.set(key, sumCounts(prev, counts));
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
