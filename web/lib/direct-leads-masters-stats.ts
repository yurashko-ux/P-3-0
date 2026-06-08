// web/lib/direct-leads-masters-stats.ts
// Розбивка «Ліди» по майстрах — periodStats (консультації факт) + F4.
// Атрибуція: ім'я з БД (після enrich) + KV; consultationMasterId адміна/Каріни ігнорується.
//
// Записи по майстру: F4 (перший платний) за датою СТВОРЕННЯ запису (paidServiceRecordCreatedAt);
// місяць і звіт з 2026 — теж по даті створення. Атрибуція — майстер КОНСУЛЬТАЦІЇ (букінг-дата).
// Консультації факт — букінг-дата (consultationBookingDate), attended.

import {
  kyivDayFromISO,
  isNonConsultantStaffName,
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  normalizeStaffMatchKey,
  pickConsultStaffFromGroup,
  type RecordGroup,
} from "@/lib/altegio/records-grouping";
import {
  namesFromMasterDisplay,
  resolveConsultationMasterFromKvGroups,
} from "@/lib/direct-consultation-master-sync";
import { computePeriodStats } from "@/lib/direct-period-stats";
import { isOnOrAfterDirectStatsMinKyivDay } from "@/lib/direct-stats-config";

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
  paidServiceDate?: Date | string | null;
  /** Коли зареєстровано запис на консультацію в Altegio */
  consultationRecordCreatedAt?: Date | string | null;
  paidServiceVisitBreakdown?: unknown;
  signedUpForPaidService?: boolean | null;
  serviceMasterName: string | null;
  serviceMasterAltegioStaffId: number | null;
};

export type DirectMasterRef = {
  id: string;
  name: string;
  altegioStaffId: number | null;
  role?: string | null;
};

export type MasterCounts = {
  consultationsFact: number;
  recordsCount: number;
  consultFactClientIds: string[];
  recordsClientIds: string[];
};

export type LeadsMasterRowOut = {
  displayName: string;
  masterId: string;
  consultationsFact: number;
  recordsCount: number;
  conversionPct: number;
  /** clientIds для кліку «Консультації факт» */
  clientIds?: string[];
  /** clientIds для кліку «Записів» (F4) */
  recordsClientIds?: string[];
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

/** Ім'я для атрибуції: прибрати телефон (+380…), залишити перше ім'я. */
export function sanitizeMasterNameForAttribution(raw: string | null | undefined): string {
  let s = (raw || "").trim();
  if (!s) return "";
  s = s.replace(/\+\d{9,15}/g, "").trim();
  s = s.replace(/\d{10,13}/g, "").trim();
  const token = firstTokenName(s);
  if (token) return token.charAt(0).toUpperCase() + token.slice(1);
  const beforePlus = s.split("+")[0]?.trim();
  return beforePlus || s;
}

export function normalizeLeadsMasterMatchKey(name: string | null | undefined): string {
  return firstTokenName(sanitizeMasterNameForAttribution(name)).replace(/['ʼ`]/g, "");
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
  return { consultationsFact: 0, recordsCount: 0, consultFactClientIds: [], recordsClientIds: [] };
}

function mergeClientIds(a: string[], b: string[]): string[] {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  return [...new Set([...a, ...b])];
}

/** @deprecated */
function mergeConsultFactClientIds(a: string[], b: string[]): string[] {
  return mergeClientIds(a, b);
}

function conversionPct(consultationsFact: number, recordsCount: number): number {
  return consultationsFact > 0 ? Math.round((recordsCount / consultationsFact) * 100) : 0;
}

export type MasterIndexRow = {
  masterId: string;
  masterName: string;
  /** admin / direct-manager / Вікторія / Каріна — не майстер консультацій у «Ліди». */
  isNonConsultant: boolean;
};

export type MasterIndex = {
  masterIdSet: Set<string>;
  rowsByMasterId: Map<string, MasterIndexRow>;
  mapStaffToMasterId: (picked: { staffId: number | null; staffName: string } | null) => string;
};

/** Каріна — адмін, ніколи не рядок консультацій у статистиці «Ліди». */
export function isKarinaAttributionKey(key: string | null | undefined): boolean {
  if (!key) return false;
  if (!isLeadsStaffAttributionKey(key)) return false;
  const token = key.slice(LEADS_STAFF_KEY_PREFIX.length);
  return normalizeStaffMatchKey(token) === "каріна";
}

function isNonConsultantDirectMaster(m: DirectMasterRef): boolean {
  const role = (m.role || "").trim();
  if (role === "admin" || role === "direct-manager") return true;
  return isNonConsultantStaffName(m.name);
}

/** Ключ staff:вікторія — лише справжні онлайн-консультації без консультанта в БД/KV. */
export function isViktoriiaAttributionKey(key: string | null | undefined): boolean {
  if (!key) return false;
  if (!isLeadsStaffAttributionKey(key)) return false;
  const token = key.slice(LEADS_STAFF_KEY_PREFIX.length);
  return normalizeStaffMatchKey(token) === "вікторія";
}

/** Якщо в БД вже є консультант — не віддавати Вікторію з consultationMasterId / KV. */
function preferConsultantNameOverViktoriia(
  attrKey: string | null,
  client: LeadsMasterClient,
  index: MasterIndex
): string | null {
  if (!attrKey || !isViktoriiaAttributionKey(attrKey)) return attrKey;
  const consultRaw = sanitizeMasterNameForAttribution(client.consultationMasterName);
  if (!consultRaw || isNonConsultantStaffName(consultRaw)) return attrKey;
  const fromName = resolveNamesToAttributionKey(
    [...namesFromMasterDisplayLocal(client.consultationMasterName), consultRaw].filter(Boolean),
    index
  );
  if (fromName && !isViktoriiaAttributionKey(fromName)) return fromName;
  return attrKey;
}

export function buildMasterIndex(masters: DirectMasterRef[]): MasterIndex {
  const masterIdByName = new Map<string, string>();
  const masterIdByFirst = new Map<string, string>();
  const masterIdByMatchKey = new Map<string, string>();
  const masterIdByStaffId = new Map<number, string>();
  const masterIdSet = new Set<string>();
  const rowsByMasterId = new Map<string, MasterIndexRow>();

  for (const m of masters) {
    masterIdSet.add(m.id);
    rowsByMasterId.set(m.id, {
      masterId: m.id,
      masterName: m.name,
      isNonConsultant: isNonConsultantDirectMaster(m),
    });
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
  if (pick) {
    const staffName = (pick.staffName || pick.displayName || "").trim();
    if (staffName) return { staffId: pick.staffId, staffName };
  }

  // День booking/date не збігся в KV — остання attended з реальним консультантом
  const attended = groups
    .filter(isAttendedConsultGroup)
    .sort((a, b) => (b.kyivDay || "").localeCompare(a.kyivDay || ""));
  for (const g of attended) {
    const picked = pickConsultStaffFromGroup(g);
    if (picked?.staffName?.trim() && !isNonConsultantStaffName(picked.staffName)) {
      return { staffId: picked.staffId, staffName: picked.staffName.trim() };
    }
  }
  return null;
}

/** Локально прибрати «+380…» з consultationMasterName (без Altegio API). */
export function healCorruptedConsultMasterName<
  T extends { consultationMasterName?: string | null },
>(clients: T[]): T[] {
  return clients.map((c) => {
    const raw = (c.consultationMasterName || "").trim();
    if (!raw || !/\+\d{9,}/.test(raw)) return c;
    const fixed = sanitizeMasterNameForAttribution(raw);
    if (!fixed || isNonConsultantStaffName(fixed)) return c;
    return { ...c, consultationMasterName: fixed };
  });
}

function masterIdToAttributionKey(masterId: string | null | undefined, index: MasterIndex): string | null {
  const id = (masterId || "").trim();
  if (!id || !index.masterIdSet.has(id)) return null;
  const row = index.rowsByMasterId.get(id);
  if (row?.isNonConsultant) return null;
  const masterName = row?.masterName || "";
  if (!masterName.trim()) return null;
  const byExcel = mapStaffNameToExcelKey(masterName);
  if (byExcel) return byExcel;
  const staffKey = toStaffAttributionKey(masterName);
  if (isKarinaAttributionKey(staffKey)) return null;
  return staffKey;
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
    const linked = index.rowsByMasterId.get(masterId);
    if (!linked?.isNonConsultant) {
      const linkedName = linked?.masterName || "";
      if (linkedName.trim()) {
        const linkedExcel = mapStaffNameToExcelKey(linkedName);
        if (linkedExcel) return linkedExcel;
        const linkedStaff = toStaffAttributionKey(linkedName);
        if (linkedStaff && !isKarinaAttributionKey(linkedStaff)) return linkedStaff;
      }
    }
  }
  const staffKey = toStaffAttributionKey(picked.staffName);
  if (isKarinaAttributionKey(staffKey)) return null;
  return staffKey;
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
    const candidates = [
      sanitizeMasterNameForAttribution(name),
      name.trim(),
    ].filter((n, i, arr) => n && arr.indexOf(n) === i);
    for (const candidate of candidates) {
      const key = staffPickToAttributionKey({ staffId: null, staffName: candidate }, index);
      if (key) return key;
    }
  }
  return null;
}

/** @deprecated */
function resolveNamesToExcelKey(names: string[], index: MasterIndex): string | null {
  return resolveNamesToAttributionKey(names, index);
}

/** Консультація факт у «Ліди»: букінг-дата з 2026, клієнт прийшов (attended). */
export function clientHasLeadsConsultFactBooking(client: LeadsMasterClient): boolean {
  if (client.consultationAttended !== true) return false;
  const consultDay = toKyivDay(client.consultationBookingDate);
  return Boolean(consultDay && isOnOrAfterDirectStatsMinKyivDay(consultDay));
}

/** F4-запис у «Ліди»: F4, дата створення запису з 2026 (paidServiceRecordCreatedAt, Kyiv). */
export function clientQualifiesForLeadsStatsRecord(client: LeadsMasterClient): boolean {
  if (!isF4Eligible(client)) return false;
  const f4Day = toKyivDay(client.paidServiceRecordCreatedAt);
  return Boolean(f4Day && isOnOrAfterDirectStatsMinKyivDay(f4Day));
}

/** Чи входить клієнт у «Консультації факт» (past) — як у computePeriodStats + getLeadsFooterVal. */
export function clientCountsTowardLeadsConsultFact(client: LeadsMasterClient, anchorKyiv: string): boolean {
  if (!clientHasLeadsConsultFactBooking(client)) return false;
  const consultDay = toKyivDay(client.consultationBookingDate);
  const { start } = getMonthBoundsFromAnchor(anchorKyiv);
  if (!consultDay || consultDay < start || consultDay > anchorKyiv) return false;
  return true;
}

/**
 * Запис після консультації для конверсії майстра: є paidServiceDate (у т.ч. майбутня) або signedUpForPaidService.
 * Дата запису не обмежує місяць — важлива лише консультація факт у anchor.
 */
export function clientHasRecordAfterConsult(client: LeadsMasterClient): boolean {
  if (client.consultationAttended !== true) return false;

  const consultDay = toKyivDay(client.consultationBookingDate);
  const paidDay = toKyivDay(client.paidServiceDate);
  if (paidDay) {
    return consultDay ? paidDay >= consultDay : true;
  }

  return client.signedUpForPaidService === true;
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

  const consultRaw = sanitizeMasterNameForAttribution(client.consultationMasterName);
  const consultRawFull = (client.consultationMasterName || "").trim();
  const hasConsultantName = consultRaw && !isNonConsultantStaffName(consultRaw);

  // Порожнє ім'я — спочатку KV (часто є в «Історії», але день не збігається)
  if (!hasConsultantName) {
    const kvEarly = pickKvConsultStaff(groups, consultBookingIso, consultationDateIso);
    const fromKvEarly = staffPickToAttributionKey(kvEarly, index);
    if (fromKvEarly) return preferConsultantNameOverViktoriia(fromKvEarly, client, index);
  }

  // БД/enrich — реальний консультант має пріоритет над consultationMasterId адміна (Вікторія)
  if (hasConsultantName) {
    const fromConsultName = resolveNamesToAttributionKey(
      [
        ...namesFromMasterDisplayLocal(client.consultationMasterName),
        consultRaw,
      ].filter(Boolean),
      index
    );
    if (fromConsultName) return fromConsultName;
    const fromRaw = staffPickToAttributionKey({ staffId: null, staffName: consultRaw }, index);
    if (fromRaw) return fromRaw;
  }

  // DirectMaster.consultationMasterId — лише для справжніх консультантів (не Вікторія/Каріна)
  const fromConsultMasterId = masterIdToAttributionKey(client.consultationMasterId, index);
  if (fromConsultMasterId) {
    return preferConsultantNameOverViktoriia(fromConsultMasterId, client, index);
  }

  // KV/API на дату консультації
  const kv = pickKvConsultStaff(groups, consultBookingIso, consultationDateIso);
  const fromKv = staffPickToAttributionKey(kv, index);
  if (fromKv) return preferConsultantNameOverViktoriia(fromKv, client, index);

  // Онлайн з Вікторією — лише якщо KV на дату теж не знайшов консультанта
  if (consultRawFull && normalizeStaffMatchKey(consultRawFull) === "вікторія") {
    const kvOnly = pickKvConsultStaff(groups, consultBookingIso, consultationDateIso);
    const kvHasConsultant =
      kvOnly?.staffName &&
      !isNonConsultantStaffName(kvOnly.staffName) &&
      !isViktoriiaAttributionKey(staffPickToAttributionKey(kvOnly, index));
    if (!kvHasConsultant) {
      const fromAdmin = staffPickToAttributionKey({ staffId: null, staffName: consultRawFull }, index);
      if (fromAdmin) return fromAdmin;
    }
  }

  // Останній fallback — санітизоване ім'я з БД
  if (consultRaw && !isNonConsultantStaffName(consultRaw)) {
    const excelKey = mapStaffNameToExcelKey(consultRaw);
    if (excelKey) return excelKey;
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
    consultFactClientIds: mergeClientIds(a.consultFactClientIds, b.consultFactClientIds),
    recordsClientIds: mergeClientIds(a.recordsClientIds, b.recordsClientIds),
  };
}

/**
 * Запис без консультації у того ж майстра (напр. Роксолана запис / Олександра консультація) —
 * переносимо запис до майстра, який уже має консультацію цього клієнта.
 */
function rebalanceOrphanMasterRecords(counts: Map<string, MasterCounts>): void {
  const consultOwnerByClient = new Map<string, string>();
  for (const [key, bucket] of counts.entries()) {
    for (const clientId of bucket.consultFactClientIds) {
      consultOwnerByClient.set(clientId, key);
    }
  }

  for (const [key, bucket] of counts.entries()) {
    if (bucket.consultationsFact > 0 || bucket.recordsCount === 0) continue;

    for (const clientId of [...bucket.recordsClientIds]) {
      const ownerKey = consultOwnerByClient.get(clientId);
      if (!ownerKey || ownerKey === key) continue;

      bucket.recordsCount -= 1;
      bucket.recordsClientIds = bucket.recordsClientIds.filter((id) => id !== clientId);

      const owner = ensureExcelCounts(counts, ownerKey);
      if (!owner.recordsClientIds.includes(clientId)) {
        owner.recordsCount += 1;
        owner.recordsClientIds.push(clientId);
      }
    }
  }
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
  unmappedRecordsClientIds: string[];
  consultFactClientIds: string[];
  recordsClientIds: string[];
} {
  const monthKey = anchorKyiv.slice(0, 7);
  const counts = initExcelCountsMap();
  let unmappedConsults = 0;
  let unmappedRecords = 0;
  const unmappedConsultClientIds: string[] = [];
  const unmappedRecordsClientIds: string[] = [];
  const consultFactClientIds: string[] = [];
  const recordsClientIds: string[] = [];

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

    // Записи по майстру + рядок місяця — F4 за датою створення запису в цьому місяці (як record-created-counts).
    if (clientQualifiesForLeadsStatsRecord(c)) {
      const f4Day = toKyivDay(c.paidServiceRecordCreatedAt);
      if (f4Day.slice(0, 7) !== monthKey) continue;

      recordsClientIds.push(c.id);

      const consultDay = toKyivDay(c.consultationBookingDate);
      const recordAttrKey = resolveConsultAttributionKey(c, consultDay, monthKey, groups, index);
      if (recordAttrKey) {
        const bucket = ensureExcelCounts(counts, recordAttrKey);
        if (!bucket.recordsClientIds.includes(c.id)) {
          bucket.recordsCount += 1;
          bucket.recordsClientIds.push(c.id);
        }
      } else {
        unmappedRecords += 1;
        unmappedRecordsClientIds.push(c.id);
      }
    }
  }

  rebalanceOrphanMasterRecords(counts);

  return {
    counts,
    unmappedConsults,
    unmappedRecords,
    unmappedConsultClientIds,
    unmappedRecordsClientIds,
    consultFactClientIds,
    recordsClientIds,
  };
}

/** 4 майстри з Excel + додаткові рядки (адміни / онлайн з KV). */
export function buildLeadsMasterRowsFromCounts(
  countsByKey: Map<string, MasterCounts>
): LeadsMasterRowOut[] {
  const rows = buildLeadsMasterRowsOutput(countsByKey);

  const dynamicKeys = [...countsByKey.keys()]
    .filter((k) => !EXCEL_MATCH_KEYS.includes(k))
    .filter((k) => !isKarinaAttributionKey(k))
    .filter((k) => {
      const c = countsByKey.get(k)!;
      // Статистика лише по майстрах консультацій — рядок без консультацій не показуємо
      return c.consultationsFact > 0;
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
      recordsClientIds: counts.recordsClientIds,
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
      recordsClientIds: counts.recordsClientIds,
    };
  });
}

/** Рядок «Інші» — консультації без атрибуції майстра. */
export function buildLeadsOtherMasterRow(
  unmappedConsults: number,
  unmappedRecords: number,
  consultClientIds: string[],
  recordsClientIds: string[]
): LeadsMasterRowOut {
  return {
    displayName: "Інші",
    masterId: LEADS_OTHER_MASTER_ID,
    consultationsFact: unmappedConsults,
    recordsCount: unmappedRecords,
    conversionPct: conversionPct(unmappedConsults, unmappedRecords),
    clientIds: consultClientIds,
    recordsClientIds,
    isOther: true,
  };
}

export function buildLeadsMasterRowsWithOther(
  countsByExcelKey: Map<string, MasterCounts>,
  unmappedConsults: number,
  unmappedRecords: number,
  consultClientIds: string[],
  recordsClientIds: string[] = []
): LeadsMasterRowOut[] {
  const rows = buildLeadsMasterRowsFromCounts(countsByExcelKey);
  if (unmappedConsults <= 0 && unmappedRecords <= 0) {
    return rows;
  }
  return [
    ...rows,
    buildLeadsOtherMasterRow(unmappedConsults, unmappedRecords, consultClientIds, recordsClientIds),
  ];
}

export function sumMasterCountsMaps(maps: Map<string, MasterCounts>[]): Map<string, MasterCounts> {
  const result = initExcelCountsMap();
  for (const map of maps) {
    for (const [key, counts] of map.entries()) {
      const prev = result.get(key) ?? emptyCounts();
      result.set(key, sumCounts(prev, counts));
    }
  }
  rebalanceOrphanMasterRecords(result);
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
