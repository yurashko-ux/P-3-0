// web/lib/direct-consultation-master-sync.ts
// Синхронізація consultationMasterName з Altegio (Visit Details / KV) — як у «Історії консультацій».

import {
  groupRecordsByClientDay,
  isAdminStaffName,
  isNonConsultantStaffName,
  isUnknownStaffName,
  kyivDayFromISO,
  normalizeRecordsLogItems,
  pickClosestConsultGroup,
  pickConsultStaffFromGroup,
  pickRecordStaffFromGroups,
  type RecordGroup,
} from "@/lib/altegio/records-grouping";
import { loadAltegioRecordGroupsForClient } from "@/lib/direct-reconcile-altegio-record-status";
import { kvRead } from "@/lib/kv";
import { KV_LIMIT_RECORDS, KV_LIMIT_WEBHOOK } from "@/lib/direct-stats-config";
import type { DirectMaster } from "@/lib/direct-masters/store";

/** Як client-webhooks / модалка «Історія» — lrange(0, 999). */
export const CONSULTATION_HISTORY_KV_LIMIT = 1000;

export type ConsultationMasterClientRef = {
  id: string;
  altegioClientId?: number | null;
  consultationBookingDate?: string | Date | null;
  /** Дата фактичної відбулої консультації (може відрізнятись від booking). */
  consultationDate?: string | Date | null;
  consultationAttended?: boolean | null;
  consultationMasterName?: string | null;
  consultationMasterId?: string | null;
  masterId?: string | null;
  masterManuallySet?: boolean | null;
  /** Якщо збігається з consultationMasterName — часто помилково скопійовано з майстра запису. */
  serviceMasterName?: string | null;
};

export type ConsultationMasterPick = {
  displayName: string;
  staffId: number | null;
  source: "visit-details" | "staff" | "kv-group" | "history-kv";
};

/** Колонка «Майстри» в модалці «Історія консультацій» — staffNames групи через кому. */
export function formatHistoryGroupStaffNames(group: RecordGroup): string {
  const names = Array.isArray(group.staffNames) ? group.staffNames.filter(Boolean) : [];
  return names.length ? names.map(String).join(", ") : "Невідомий майстер";
}

/**
 * Ім'я для таблиці: спочатку консультант (не адмін), інакше — як у «Історії» (напр. онлайн з Вікторією).
 */
export function formatConsultationMasterForTableFromGroup(group: RecordGroup): string | null {
  const raw = formatHistoryGroupStaffNames(group);
  if (!raw || raw === "Невідомий майстер") return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const consultants = parts.filter(
    (n) => n && !isUnknownStaffName(n) && !isAdminStaffName(n) && !isNonConsultantStaffName(n)
  );
  return consultants.length > 0 ? consultants.join(", ") : raw;
}

export function resolveConsultationVisitIso(
  client: Pick<
    ConsultationMasterClientRef,
    "consultationBookingDate" | "consultationDate" | "consultationAttended"
  >
): string | null {
  if (client.consultationAttended && client.consultationDate != null) {
    return String(client.consultationDate);
  }
  if (client.consultationBookingDate != null) {
    return String(client.consultationBookingDate);
  }
  if (client.consultationDate != null) {
    return String(client.consultationDate);
  }
  return null;
}

function sortAttendedGroupsByRecencyDesc(groups: RecordGroup[]): RecordGroup[] {
  return [...groups].sort((a, b) => {
    const dayCmp = (b.kyivDay || "").localeCompare(a.kyivDay || "");
    if (dayCmp !== 0) return dayCmp;
    return (b.attendanceSetAt || "").localeCompare(a.attendanceSetAt || "");
  });
}

function isAttendedConsultGroup(g: RecordGroup): boolean {
  return (
    g.groupType === "consultation" &&
    (g.attendanceStatus === "arrived" || g.attendance === 1 || g.attendance === 2)
  );
}

/**
 * «Прийшов» для конкретної консультації: спочатку день booking/date, інакше найближча, інакше остання.
 */
export function pickAttendedConsultGroupForClient(
  groups: RecordGroup[],
  consultBookingIso?: string | null | undefined,
  consultationDateIso?: string | null | undefined
): RecordGroup | null {
  const attended = groups.filter(isAttendedConsultGroup);
  if (!attended.length) return null;

  const visitIso = resolveConsultVisitIsoForGroupPick(consultBookingIso, consultationDateIso);
  const targetDay = visitIso ? kyivDayFromISO(String(visitIso)) : "";

  if (targetDay) {
    const sameDay = attended.filter((g) => g.kyivDay === targetDay);
    if (sameDay.length) {
      return sortAttendedGroupsByRecencyDesc(sameDay)[0] ?? null;
    }
    const closest = pickClosestConsultGroup(attended, visitIso);
    if (closest && isAttendedConsultGroup(closest)) return closest;
  }

  return sortAttendedGroupsByRecencyDesc(attended)[0] ?? null;
}

function resolveConsultVisitIsoForGroupPick(
  consultBookingIso?: string | null,
  consultationDateIso?: string | null
): string | null {
  if (consultationDateIso != null && String(consultationDateIso).trim()) {
    return String(consultationDateIso);
  }
  if (consultBookingIso != null && String(consultBookingIso).trim()) {
    return String(consultBookingIso);
  }
  return null;
}

/** Групи KV для одного клієнта — той самий пайплайн, що client-webhooks / «Історія». */
export async function loadConsultationHistoryGroupsForClient(
  altegioClientId: number
): Promise<RecordGroup[]> {
  const map = await loadConsultGroupsByAltegioIds([altegioClientId]);
  return map.get(altegioClientId) || [];
}

/** «Головний (Інший1, Інший2)» → імена; спочатку з дужок. */
export function namesFromMasterDisplay(raw: string | null | undefined): string[] {
  const s = (raw || "").trim();
  if (!s) return [];
  const m = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return [s];
  const main = m[1].trim();
  const others = m[2]
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return [...others, main];
}

function firstConsultStaffName(names: string[]): string | null {
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed && !isAdminStaffName(trimmed) && !isNonConsultantStaffName(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/** Вибір майстра консультації з Visit Details / staff вебхука. */
export function pickConsultationMasterFromWebhook(
  mastersDisplayString: string | null | undefined,
  staffName: string | null | undefined,
  staffId: number | null | undefined
): ConsultationMasterPick | null {
  const display = (mastersDisplayString || "").trim();
  if (display) {
    const fromDisplay = firstConsultStaffName(namesFromMasterDisplay(display));
    if (fromDisplay) {
      return {
        displayName: fromDisplay,
        staffId: staffId ?? null,
        source: "visit-details",
      };
    }
  }

  const sn = (staffName || "").trim();
  if (sn && !isAdminStaffName(sn) && !isNonConsultantStaffName(sn)) {
    return { displayName: sn, staffId: staffId ?? null, source: "staff" };
  }

  return null;
}

export function pickConsultationMasterFromGroup(
  group: RecordGroup | null | undefined
): ConsultationMasterPick | null {
  if (!group) return null;

  const displayName = formatConsultationMasterForTableFromGroup(group);
  if (!displayName) return null;

  const picked = pickConsultStaffFromGroup(group);
  return {
    displayName,
    staffId: picked?.staffId ?? null,
    source: "history-kv",
  };
}

export async function loadAllConsultGroupsByClient(): Promise<Map<number, RecordGroup[]>> {
  const [rawRecords, rawWebhooks] = await Promise.all([
    kvRead.lrange("altegio:records:log", 0, KV_LIMIT_RECORDS - 1),
    kvRead.lrange("altegio:webhook:log", 0, KV_LIMIT_WEBHOOK - 1),
  ]);
  return groupRecordsByClientDay(normalizeRecordsLogItems([...rawRecords, ...rawWebhooks]));
}

/** KV як у «Історії консультацій» — швидко, для невеликого списку клієнтів. */
export async function loadConsultGroupsByAltegioIds(
  altegioClientIds: number[]
): Promise<Map<number, RecordGroup[]>> {
  const idSet = new Set(altegioClientIds.map(Number).filter(Number.isFinite));
  if (!idSet.size) return new Map();

  const limit = CONSULTATION_HISTORY_KV_LIMIT - 1;
  const [rawRecords, rawWebhooks] = await Promise.all([
    kvRead.lrange("altegio:records:log", 0, limit),
    kvRead.lrange("altegio:webhook:log", 0, limit),
  ]);
  const allGroups = groupRecordsByClientDay(
    normalizeRecordsLogItems([...rawRecords, ...rawWebhooks])
  );
  const scoped = new Map<number, RecordGroup[]>();
  for (const id of idSet) {
    const groups = allGroups.get(id);
    if (groups?.length) scoped.set(id, groups);
  }
  return scoped;
}

/** Чи потрібно підставити майстра з KV замість значення в БД. */
export function needsConsultationMasterResolve(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return true;
  return isNonConsultantStaffName(n);
}

/** Підібрати майстра з KV — остання «Прийшов» (не скасовано / pending). */
export function resolveConsultationMasterFromKvGroups(
  groups: RecordGroup[],
  consultBookingIso: string | null | undefined,
  consultationDateIso?: string | null | undefined
): ConsultationMasterPick | null {
  if (!groups.length) return null;

  const attendedGroup = pickAttendedConsultGroupForClient(
    groups,
    consultBookingIso,
    consultationDateIso
  );
  if (!attendedGroup) return null;

  return pickConsultationMasterFromGroup(attendedGroup);
}

/** @deprecated Використовуйте resolveConsultationMasterFromKvGroups */
export function pickConsultationMasterPickFromGroups(
  groups: RecordGroup[],
  consultBookingIso: string | null | undefined,
  consultationDateIso?: string | null | undefined
): ConsultationMasterPick | null {
  return resolveConsultationMasterFromKvGroups(groups, consultBookingIso, consultationDateIso);
}

function pickMasterForClientRef(
  client: ConsultationMasterClientRef,
  groups: RecordGroup[]
): ConsultationMasterPick | null {
  const bookingIso =
    client.consultationBookingDate != null ? String(client.consultationBookingDate) : null;
  const consultDateIso =
    client.consultationDate != null ? String(client.consultationDate) : null;
  return resolveConsultationMasterFromKvGroups(groups, bookingIso, consultDateIso);
}

/** Групи з Altegio API — той самий пайплайн, що модалка «Історія консультацій». */
async function loadGroupsFromAltegioApi(altegioClientId: number): Promise<RecordGroup[]> {
  try {
    const { allGroups } = await loadAltegioRecordGroupsForClient(altegioClientId);
    return (allGroups || []) as RecordGroup[];
  } catch (err) {
    console.warn("[consultation-master-sync] API groups failed:", altegioClientId, err);
    return [];
  }
}

async function loadApiGroupsBatch(
  altegioIds: number[],
  maxIds = 30
): Promise<Map<number, RecordGroup[]>> {
  const out = new Map<number, RecordGroup[]>();
  const unique = [...new Set(altegioIds.filter(Number.isFinite))].slice(0, maxIds);
  if (!unique.length) return out;

  const concurrency = 5;
  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (id) => {
        const groups = await loadGroupsFromAltegioApi(id);
        if (groups.length) out.set(id, groups);
      })
    );
  }
  return out;
}

function masterNameMatchToken(name: string | null | undefined): string {
  return (name || "").trim().toLowerCase().split(/\s+/)[0].replace(/['ʼ`]/g, "");
}

function clientNeedsConsultationMasterFromKv(c: ConsultationMasterClientRef): boolean {
  if (c.altegioClientId == null) return false;
  const name = (c.consultationMasterName || "").trim();
  if (!name) return c.consultationAttended === true;
  const service = (c.serviceMasterName || "").trim();
  if (service && masterNameMatchToken(name) === masterNameMatchToken(service)) {
    return true;
  }
  return needsConsultationMasterResolve(name);
}

export type EnrichConsultationMasterOptions = {
  /** Як record-history — лише для невеликого списку (Direct clientIds). */
  apiFallback?: boolean;
  apiFallbackMax?: number;
  /** Спочатку attended консультації (stats bulk). */
  prioritizeAttended?: boolean;
};

/** Підставити consultationMasterName з KV для відображення в таблиці (без запису в БД). */
export async function enrichClientsConsultationMasterFromKv<
  T extends ConsultationMasterClientRef & { consultationAttended?: boolean | null },
>(
  clients: T[],
  groupsByClientPreload?: Map<number, RecordGroup[]>,
  options?: EnrichConsultationMasterOptions
): Promise<T[]> {
  const apiFallback = options?.apiFallback ?? false;
  const apiFallbackMax = options?.apiFallbackMax ?? 30;
  const needResolve = clients.filter(clientNeedsConsultationMasterFromKv);
  if (!needResolve.length) return clients;

  let groupsByClient: Map<number, RecordGroup[]>;
  try {
    if (groupsByClientPreload) {
      groupsByClient = groupsByClientPreload;
    } else {
      const altegioIds = [
        ...new Set(
          needResolve.map((c) => Number(c.altegioClientId)).filter(Number.isFinite)
        ),
      ];
      groupsByClient =
        altegioIds.length > 0 && altegioIds.length <= 150
          ? await loadConsultGroupsByAltegioIds(altegioIds)
          : await loadAllConsultGroupsByClient();
    }
  } catch (err) {
    console.warn("[consultation-master-sync] enrichClientsConsultationMasterFromKv KV failed:", err);
    return clients;
  }

  const resolveById = new Map<string, string>();
  let skippedNoGroups = 0;
  let skippedNoPick = 0;
  const needApiIds = new Set<number>();

  for (const c of needResolve) {
    const altegioId = Number(c.altegioClientId);
    const groups = groupsByClient.get(altegioId) || [];
    if (!groups.length) {
      needApiIds.add(altegioId);
      continue;
    }
    const pick = pickMasterForClientRef(c, groups);
    if (pick?.displayName?.trim()) {
      const name = pick.displayName.trim();
      // KV інколи повертає адміна (Вікторія) — перевіряємо через API, як у Direct clientIds
      if (isNonConsultantStaffName(name)) {
        needApiIds.add(altegioId);
      } else {
        resolveById.set(c.id, name);
      }
    } else {
      needApiIds.add(altegioId);
    }
  }

  if (needApiIds.size && apiFallback) {
    const attendedFirst = options?.prioritizeAttended ?? false;
    const apiIdList = [...needApiIds];
    if (attendedFirst) {
      const attendedIds = new Set(
        needResolve
          .filter((c) => c.consultationAttended === true)
          .map((c) => Number(c.altegioClientId))
          .filter(Number.isFinite)
      );
      apiIdList.sort((a, b) => {
        const aAtt = attendedIds.has(a) ? 1 : 0;
        const bAtt = attendedIds.has(b) ? 1 : 0;
        return bAtt - aAtt;
      });
    }
    const apiGroupsById = await loadApiGroupsBatch(apiIdList, apiFallbackMax);
    for (const c of needResolve) {
      if (resolveById.has(c.id)) continue;
      const altegioId = Number(c.altegioClientId);
      const apiGroups = apiGroupsById.get(altegioId);
      if (!apiGroups?.length) {
        skippedNoGroups++;
        continue;
      }
      const pick = pickMasterForClientRef(c, apiGroups);
      if (!pick?.displayName?.trim()) {
        skippedNoPick++;
        continue;
      }
      resolveById.set(c.id, pick.displayName.trim());
    }
  }

  // Після API: fallback на KV (напр. онлайн лише з Вікторією, якщо API не знайшов консультанта)
  for (const c of needResolve) {
    if (resolveById.has(c.id)) continue;
    const altegioId = Number(c.altegioClientId);
    const groups = groupsByClient.get(altegioId) || [];
    if (!groups.length) continue;
    const pick = pickMasterForClientRef(c, groups);
    if (pick?.displayName?.trim()) {
      resolveById.set(c.id, pick.displayName.trim());
    }
  }

  if (needResolve.length > 0 && resolveById.size === 0) {
    console.warn("[consultation-master-sync] enrich: 0 resolved", {
      needResolve: needResolve.length,
      skippedNoGroups,
      skippedNoPick,
      kvClients: groupsByClient.size,
      apiFallback: needApiIds.size,
    });
  }

  if (!resolveById.size) return clients;

  return clients.map((c) => {
    const resolved = resolveById.get(c.id);
    if (!resolved) return c;
    return { ...c, consultationMasterName: resolved };
  });
}

export type RecordMasterClientRef = {
  id: string;
  altegioClientId?: number | null;
  serviceMasterName?: string | null;
  paidServiceDate?: string | Date | null;
  paidServiceRecordCreatedAt?: string | Date | null;
  signedUpForPaidService?: boolean | null;
};

function clientNeedsRecordMasterFromKv(c: RecordMasterClientRef): boolean {
  if (c.altegioClientId == null) return false;
  const hasRecord =
    Boolean(c.paidServiceDate != null && String(c.paidServiceDate).trim()) ||
    c.signedUpForPaidService === true;
  if (!hasRecord) return false;
  const name = (c.serviceMasterName || "").trim();
  if (!name) return true;
  return isNonConsultantStaffName(name);
}

/** Підставити serviceMasterName з KV/API для колонки «Майстер запису» (без запису в БД). */
export async function enrichClientsRecordMasterFromKv<T extends RecordMasterClientRef>(
  clients: T[],
  groupsByClientPreload?: Map<number, RecordGroup[]>,
  options?: Pick<EnrichConsultationMasterOptions, "apiFallback" | "apiFallbackMax">
): Promise<T[]> {
  const apiFallback = options?.apiFallback ?? false;
  const apiFallbackMax = options?.apiFallbackMax ?? 30;
  const needResolve = clients.filter(clientNeedsRecordMasterFromKv);
  if (!needResolve.length) return clients;

  let groupsByClient: Map<number, RecordGroup[]>;
  try {
    if (groupsByClientPreload) {
      groupsByClient = groupsByClientPreload;
    } else {
      const altegioIds = [
        ...new Set(needResolve.map((c) => Number(c.altegioClientId)).filter(Number.isFinite)),
      ];
      groupsByClient =
        altegioIds.length > 0 && altegioIds.length <= 150
          ? await loadConsultGroupsByAltegioIds(altegioIds)
          : await loadAllConsultGroupsByClient();
    }
  } catch (err) {
    console.warn("[consultation-master-sync] enrichClientsRecordMasterFromKv KV failed:", err);
    return clients;
  }

  const resolveById = new Map<string, string>();
  const needApiIds = new Set<number>();

  for (const c of needResolve) {
    const altegioId = Number(c.altegioClientId);
    const groups = groupsByClient.get(altegioId) || [];
    const paidIso = c.paidServiceDate != null ? String(c.paidServiceDate) : null;
    const createdIso =
      c.paidServiceRecordCreatedAt != null ? String(c.paidServiceRecordCreatedAt) : null;
    const pick = groups.length ? pickRecordStaffFromGroups(groups, paidIso, createdIso) : null;
    if (pick?.staffName?.trim() && !isNonConsultantStaffName(pick.staffName)) {
      resolveById.set(c.id, pick.staffName.trim());
    } else if (altegioId) {
      needApiIds.add(altegioId);
    }
  }

  if (needApiIds.size && apiFallback) {
    const apiGroupsById = await loadApiGroupsBatch([...needApiIds], apiFallbackMax);
    for (const c of needResolve) {
      if (resolveById.has(c.id)) continue;
      const altegioId = Number(c.altegioClientId);
      const apiGroups = apiGroupsById.get(altegioId);
      if (!apiGroups?.length) continue;
      const paidIso = c.paidServiceDate != null ? String(c.paidServiceDate) : null;
      const createdIso =
        c.paidServiceRecordCreatedAt != null ? String(c.paidServiceRecordCreatedAt) : null;
      const pick = pickRecordStaffFromGroups(apiGroups, paidIso, createdIso);
      if (pick?.staffName?.trim() && !isNonConsultantStaffName(pick.staffName)) {
        resolveById.set(c.id, pick.staffName.trim());
      }
    }
  }

  if (!resolveById.size) return clients;

  return clients.map((c) => {
    const resolved = resolveById.get(c.id);
    if (!resolved) return c;
    return { ...c, serviceMasterName: resolved };
  });
}

function isAdminRoleMaster(m: DirectMaster | null | undefined): boolean {
  if (!m) return false;
  return m.role === "admin" || m.role === "direct-manager";
}

export type ConsultationMasterFieldUpdates = {
  consultationMasterName?: string;
  consultationMasterId?: string;
  masterId?: string;
};

/** Побудувати оновлення полів майстра консультації (без запису в БД). */
export async function buildConsultationMasterFieldUpdates(
  client: ConsultationMasterClientRef,
  pick: ConsultationMasterPick,
  deps: {
    getMasterByName: (name: string) => Promise<DirectMaster | null>;
    getMasterByAltegioStaffId: (staffId: number) => Promise<DirectMaster | null>;
    getMasterById: (id: string) => Promise<DirectMaster | null>;
  }
): Promise<ConsultationMasterFieldUpdates> {
  const prevName = (client.consultationMasterName || "").trim();
  const nextName = pick.displayName.trim();
  if (!nextName) return {};

  let consultantMaster: DirectMaster | null = null;
  if (pick.staffId != null) {
    consultantMaster = await deps.getMasterByAltegioStaffId(pick.staffId);
  }
  if (!consultantMaster) {
    const candidate = firstConsultStaffName(namesFromMasterDisplay(nextName)) ?? nextName;
    consultantMaster = await deps.getMasterByName(candidate);
  }

  const nameChanged = prevName !== nextName;
  const idChanged =
    consultantMaster != null &&
    (client.consultationMasterId || "").trim() !== consultantMaster.id;

  const updates: ConsultationMasterFieldUpdates = {};
  if (nameChanged) updates.consultationMasterName = nextName;
  if (consultantMaster && (nameChanged || idChanged)) {
    updates.consultationMasterId = consultantMaster.id;
  }

  if (!client.masterManuallySet && consultantMaster && !isAdminRoleMaster(consultantMaster)) {
    const currentLead = client.masterId
      ? await deps.getMasterById(client.masterId)
      : null;
    const leadIsAdmin = isAdminRoleMaster(currentLead);
    const leadDiffers = (client.masterId || "").trim() !== consultantMaster.id;
    if (leadIsAdmin || (leadDiffers && nameChanged)) {
      updates.masterId = consultantMaster.id;
    }
  }

  return updates;
}

export async function resolveConsultationMasterPickForClient(
  client: ConsultationMasterClientRef,
  webhook?: {
    mastersDisplayString?: string | null;
    staffName?: string | null;
    staffId?: number | null;
    consultationDatetime?: string | null;
  },
  groupsByClientPreload?: Map<number, RecordGroup[]>
): Promise<ConsultationMasterPick | null> {
  const fromWebhook = pickConsultationMasterFromWebhook(
    webhook?.mastersDisplayString,
    webhook?.staffName,
    webhook?.staffId ?? null
  );
  if (fromWebhook) return fromWebhook;

  if (client.altegioClientId != null) {
    const bookingIso =
      webhook?.consultationDatetime ??
      (client.consultationBookingDate != null ? String(client.consultationBookingDate) : null);
    const consultDateIso =
      client.consultationDate != null ? String(client.consultationDate) : null;
    const groupsByClient =
      groupsByClientPreload ?? (await loadAllConsultGroupsByClient());
    const kvGroups = groupsByClient.get(Number(client.altegioClientId)) || [];

    if (kvGroups.length) {
      const fromKv = resolveConsultationMasterFromKvGroups(kvGroups, bookingIso, consultDateIso);
      if (fromKv?.displayName?.trim()) return fromKv;
    }

    const apiGroups = await loadGroupsFromAltegioApi(Number(client.altegioClientId));
    if (apiGroups.length) {
      return resolveConsultationMasterFromKvGroups(apiGroups, bookingIso, consultDateIso);
    }
  }

  return null;
}

/** Застосувати синхронізацію майстра консультації (вебхук / batch). */
export async function applyConsultationMasterSync(
  client: ConsultationMasterClientRef,
  webhook: {
    mastersDisplayString?: string | null;
    staffName?: string | null;
    staffId?: number | null;
    consultationDatetime?: string | null;
  } | undefined,
  deps: {
    getMasterByName: (name: string) => Promise<DirectMaster | null>;
    getMasterByAltegioStaffId: (staffId: number) => Promise<DirectMaster | null>;
    getMasterById: (id: string) => Promise<DirectMaster | null>;
    saveClient: (
      client: ConsultationMasterClientRef & Record<string, unknown>,
      source: string,
      meta: Record<string, unknown>
    ) => Promise<void>;
  },
  groupsByClientPreload?: Map<number, RecordGroup[]>
): Promise<{ updated: boolean; pick: ConsultationMasterPick | null; updates: ConsultationMasterFieldUpdates }> {
  const pick = await resolveConsultationMasterPickForClient(client, webhook, groupsByClientPreload);
  if (!pick) return { updated: false, pick: null, updates: {} };

  const updates = await buildConsultationMasterFieldUpdates(client, pick, deps);
  if (Object.keys(updates).length === 0) {
    return { updated: false, pick, updates: {} };
  }

  await deps.saveClient(
    { ...client, ...updates, updatedAt: new Date().toISOString() },
    "consultation-master-sync",
    { pick, updates, source: pick.source }
  );

  return { updated: true, pick, updates };
}
