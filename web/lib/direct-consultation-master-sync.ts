// web/lib/direct-consultation-master-sync.ts
// Синхронізація consultationMasterName з Altegio (Visit Details / KV) — як у «Історії консультацій».

import {
  groupRecordsByClientDay,
  isAdminStaffName,
  isNonConsultantStaffName,
  kyivDayFromISO,
  normalizeRecordsLogItems,
  pickClosestConsultGroup,
  pickConsultStaffFromGroup,
  type RecordGroup,
} from "@/lib/altegio/records-grouping";
import { kvRead } from "@/lib/kv";
import { KV_LIMIT_RECORDS, KV_LIMIT_WEBHOOK } from "@/lib/direct-stats-config";
import type { DirectMaster } from "@/lib/direct-masters/store";

export type ConsultationMasterClientRef = {
  id: string;
  altegioClientId?: number | null;
  consultationBookingDate?: string | Date | null;
  consultationMasterName?: string | null;
  consultationMasterId?: string | null;
  masterId?: string | null;
  masterManuallySet?: boolean | null;
};

export type ConsultationMasterPick = {
  displayName: string;
  staffId: number | null;
  source: "visit-details" | "staff" | "kv-group";
};

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
  const picked = pickConsultStaffFromGroup(group);
  if (!picked?.staffName?.trim()) return null;

  const staffNames = Array.isArray(group.staffNames) ? group.staffNames.filter(Boolean) : [];
  const consultNames = staffNames.filter(
    (n) => n.trim() && !isAdminStaffName(n) && !isNonConsultantStaffName(n)
  );
  const displayName =
    consultNames.length > 0 ? consultNames.join(", ") : picked.staffName.trim();

  return {
    displayName,
    staffId: picked.staffId ?? null,
    source: "kv-group",
  };
}

async function loadConsultGroupForClientDay(
  altegioClientId: number,
  consultationDatetime: string | null | undefined
): Promise<RecordGroup | null> {
  const [rawRecords, rawWebhooks] = await Promise.all([
    kvRead.lrange("altegio:records:log", 0, KV_LIMIT_RECORDS - 1),
    kvRead.lrange("altegio:webhook:log", 0, KV_LIMIT_WEBHOOK - 1),
  ]);
  const groupsByClient = groupRecordsByClientDay(normalizeRecordsLogItems([...rawRecords, ...rawWebhooks]));
  const groups = groupsByClient.get(altegioClientId) || [];
  if (!groups.length) return null;

  const iso =
    consultationDatetime != null
      ? typeof consultationDatetime === "string"
        ? consultationDatetime
        : new Date(consultationDatetime).toISOString()
      : null;

  const closest = pickClosestConsultGroup(groups, iso);
  if (closest) return closest;

  const day = iso ? kyivDayFromISO(iso) : "";
  if (day) {
    return groups.find((g) => g.groupType === "consultation" && g.kyivDay === day) ?? null;
  }
  return groups.find((g) => g.groupType === "consultation") ?? null;
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
  }
): Promise<ConsultationMasterPick | null> {
  const fromWebhook = pickConsultationMasterFromWebhook(
    webhook?.mastersDisplayString,
    webhook?.staffName,
    webhook?.staffId ?? null
  );
  if (fromWebhook) return fromWebhook;

  if (client.altegioClientId != null) {
    const dt =
      webhook?.consultationDatetime ??
      (client.consultationBookingDate != null ? String(client.consultationBookingDate) : null);
    const group = await loadConsultGroupForClientDay(Number(client.altegioClientId), dt);
    return pickConsultationMasterFromGroup(group);
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
  }
): Promise<{ updated: boolean; pick: ConsultationMasterPick | null; updates: ConsultationMasterFieldUpdates }> {
  const pick = await resolveConsultationMasterPickForClient(client, webhook);
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
