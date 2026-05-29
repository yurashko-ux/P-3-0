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
  type RecordGroup,
} from "@/lib/altegio/records-grouping";
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

function sortGroupsByKyivDayDesc(groups: RecordGroup[]): RecordGroup[] {
  return [...groups].sort((a, b) => (b.kyivDay || "").localeCompare(a.kyivDay || ""));
}

/** Одна attended-група: день факту → день booking → найновіша «Прийшов» (не no-show). */
export function pickAttendedConsultGroupForClient(
  groups: RecordGroup[],
  consultBookingIso: string | null | undefined,
  consultationDateIso?: string | null | undefined
): RecordGroup | null {
  const attended = groups.filter(isAttendedConsultGroup);
  if (!attended.length) return null;

  const consultDay = consultationDateIso ? kyivDayFromISO(String(consultationDateIso)) : "";
  const bookingDay = consultBookingIso ? kyivDayFromISO(String(consultBookingIso)) : "";

  if (consultDay) {
    const onDay = attended.find((g) => g.kyivDay === consultDay);
    if (onDay) return onDay;
  }
  if (bookingDay && bookingDay !== consultDay) {
    const onBooking = attended.find((g) => g.kyivDay === bookingDay);
    if (onBooking) return onBooking;
  }

  return sortGroupsByKyivDayDesc(attended)[0] ?? null;
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

function isAttendedConsultGroup(g: RecordGroup): boolean {
  return (
    g.groupType === "consultation" &&
    (g.attendanceStatus === "arrived" || g.attendance === 1 || g.attendance === 2)
  );
}

/** Чи потрібно підставити майстра з KV замість значення в БД. */
export function needsConsultationMasterResolve(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return true;
  return isNonConsultantStaffName(n);
}

/** Одна attended-група з «Історії» → майстер; не змішуємо з іншими візитами (Marta: 13.05, не Olena 05.05). */
export function pickConsultationMasterPickFromGroups(
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
  if (attendedGroup) {
    const pick = pickConsultationMasterFromGroup(attendedGroup);
    if (pick) return pick;
  }

  const visitIso = consultationDateIso || consultBookingIso;
  const closest = pickClosestConsultGroup(groups, visitIso);
  if (closest) {
    return pickConsultationMasterFromGroup(closest);
  }

  for (const g of sortGroupsByKyivDayDesc(groups.filter((x) => x.groupType === "consultation"))) {
    const pick = pickConsultationMasterFromGroup(g);
    if (pick) return pick;
  }

  return null;
}

/** Підставити consultationMasterName з KV для відображення в таблиці (без запису в БД). */
export async function enrichClientsConsultationMasterFromKv<
  T extends ConsultationMasterClientRef & { consultationAttended?: boolean | null },
>(clients: T[], groupsByClientPreload?: Map<number, RecordGroup[]>): Promise<T[]> {
  const needResolve = clients.filter(
    (c) => c.consultationAttended === true && c.altegioClientId != null
  );
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
  for (const c of needResolve) {
    const groups = groupsByClient.get(Number(c.altegioClientId)) || [];
    if (!groups.length) {
      skippedNoGroups++;
      continue;
    }
    const bookingIso =
      c.consultationBookingDate != null ? String(c.consultationBookingDate) : null;
    const consultDateIso =
      c.consultationDate != null ? String(c.consultationDate) : null;
    const pick = pickConsultationMasterPickFromGroups(groups, bookingIso, consultDateIso);
    if (!pick?.displayName?.trim()) {
      skippedNoPick++;
      continue;
    }
    resolveById.set(c.id, pick.displayName.trim());
  }

  if (needResolve.length > 0 && resolveById.size === 0) {
    console.warn("[consultation-master-sync] enrich: 0 resolved", {
      needResolve: needResolve.length,
      skippedNoGroups,
      skippedNoPick,
      kvClients: groupsByClient.size,
    });
  }

  if (!resolveById.size) return clients;

  return clients.map((c) => {
    const resolved = resolveById.get(c.id);
    if (!resolved) return c;
    return { ...c, consultationMasterName: resolved };
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
    const groups = groupsByClient.get(Number(client.altegioClientId)) || [];
    return pickConsultationMasterPickFromGroups(groups, bookingIso, consultDateIso);
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
