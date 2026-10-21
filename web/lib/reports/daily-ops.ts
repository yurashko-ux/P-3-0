// Збірка щоденного операційного звіту з існуючих джерел Direct / Binotel / Банк.

import { getAllDirectClients } from "@/lib/direct-store";
import { kvRead } from "@/lib/kv";
import { clientCountsTowardNewLeadsKpi, getTodayKyiv, toKyivDay } from "@/lib/direct-stats-config";
import { computePeriodStats } from "@/lib/direct-period-stats";
import { computeBinotelCallsFilterCountsFromDb } from "@/lib/direct-binotel-filter-counts";
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  pickClosestConsultGroup,
  pickRecordCreatedAtISOFromGroup,
} from "@/lib/altegio/records-grouping";
import { countBankUnmatchedForKyivDay } from "@/lib/reports/bank-unmatched-counts";
import {
  countPaidRecordsCreatedOnKyivDay,
  getActiveBaseDailyMetrics,
  getBinotelIncomingMissedOnKyivDay,
} from "@/lib/reports/daily-ops-extras";
import type { DirectClient } from "@/lib/direct-types";
import { countLeadsStatsRecordsOnKyivDay } from "@/lib/direct-leads-stats-filters";
import { fetchFinanceSummary } from "@/lib/altegio/analytics";
import { ensureLeadSources } from "@/lib/lead-sources";

/** Рядок джерела нових лідів у щоденному звіті (лише кількість, без IG-юзернеймів). */
export type DailyOpsLeadSourceCount = {
  code: string;
  name: string;
  mark: string | null;
  count: number;
};

export type DailyOpsReportData = {
  kyivDay: string;
  /** Загалом нових лідів за день (KPI). */
  newLeadsCount: number;
  /** Усі активні джерела + їх кількість нових лідів за день (у т.ч. 0). */
  newLeadSourceCounts: DailyOpsLeadSourceCount[];
  /** Нові ліди без leadAgency («не визначено»). */
  newLeadsUndefinedCount: number;
  /** Колонка «Записів» у таблиці «Ліди» (F4 за день). */
  leadsRecordsCount: number;
  consultationCreated: number;
  consultationRealized: number;
  newClientsCount: number;
  consultationBookedToday: number;
  rebookingsCount: number;
  recordsCreatedCount: number;
  recordsRealizedCountToday: number;
  turnoverToday: number;
  incomingUnmatched: number;
  outgoingUnmatched: number;
  callsIncoming: number;
  callsOutgoing: number;
  callsMissed: number;
  callsMissedNames: string[];
  activeBaseCount: number;
  removedFromActiveBaseCount: number;
  removedFromActiveBaseNames: string[];
  removedFromActiveBaseClientIds: string[];
  returnedToActiveBaseCount: number;
  returnedToActiveBaseNames: string[];
  returnedToActiveBaseClientIds: string[];
};

async function enrichClientsWithKvConsultCreatedAt<
  T extends {
    altegioClientId?: unknown;
    consultationBookingDate?: unknown;
    consultationRecordCreatedAt?: unknown;
  },
>(clients: T[]): Promise<T[]> {
  try {
    const rawItemsRecords = await kvRead.lrange("altegio:records:log", 0, 9999);
    const rawItemsWebhook = await kvRead.lrange("altegio:webhook:log", 0, 9999);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);

    return clients.map((c) => {
      if (!c.altegioClientId || !c.consultationBookingDate) return c;
      const groups = groupsByClient.get(Number(c.altegioClientId)) ?? [];
      const consultGroup = pickClosestConsultGroup(
        groups,
        c.consultationBookingDate as string,
      );
      const kvConsultCreatedAt = pickRecordCreatedAtISOFromGroup(consultGroup);
      if (kvConsultCreatedAt) {
        return { ...c, consultationRecordCreatedAt: kvConsultCreatedAt };
      }
      return c;
    });
  } catch (err) {
    console.warn("[reports/daily-ops] KV enrichment пропущено:", err);
    return clients;
  }
}

/**
 * Оборот дня — виручка Altegio (послуги + товари), як «Оборот (Виручка)» у фінзвіті.
 * Сума з карток Direct неповна: там лише клієнти бази і лише їхній поточний платний запис.
 */
async function fetchAltegioTurnoverForKyivDay(kyivDay: string): Promise<number | null> {
  try {
    const summary = await fetchFinanceSummary({ date_from: kyivDay, date_to: kyivDay });
    const total = summary.totals.total;
    if (!Number.isFinite(total)) return null;
    console.log("[reports/daily-ops] Оборот з Altegio за день", {
      kyivDay,
      total,
      services: summary.totals.services,
      goods: summary.totals.goods,
    });
    return total;
  } catch (err) {
    console.warn("[reports/daily-ops] Не вдалося взяти оборот з Altegio", {
      kyivDay,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function buildDailyOpsReport(options?: {
  kyivDay?: string | null;
}): Promise<DailyOpsReportData> {
  const kyivDay = getTodayKyiv(options?.kyivDay);
  let clients = await getAllDirectClients();
  clients = await enrichClientsWithKvConsultCreatedAt(clients);

  const periodStats = computePeriodStats(clients, {
    clientsForBookedStats: clients,
    todayKyiv: kyivDay,
  });
  const { today } = periodStats;

  const [bankUnmatched, calls, activeBase, incomingMissed, altegioTurnover] = await Promise.all([
    countBankUnmatchedForKyivDay(kyivDay),
    computeBinotelCallsFilterCountsFromDb({ kyivDay }),
    getActiveBaseDailyMetrics(kyivDay),
    getBinotelIncomingMissedOnKyivDay(kyivDay),
    fetchAltegioTurnoverForKyivDay(kyivDay),
  ]);

  const paidCreated = countPaidRecordsCreatedOnKyivDay(clients as DirectClient[], kyivDay);
  const newLeadsCount = today.newLeadsCount ?? 0;

  // Розбивка нових лідів по активних джерелах + «не визначено» (без IG-юзернеймів).
  const countByCode = new Map<string, number>();
  let newLeadsUndefinedCount = 0;
  for (const client of clients) {
    if (!clientCountsTowardNewLeadsKpi(client)) continue;
    if (toKyivDay(client.firstContactDate) !== kyivDay) continue;
    const code = (client.leadAgency || "").trim();
    if (!code) {
      newLeadsUndefinedCount += 1;
      continue;
    }
    countByCode.set(code, (countByCode.get(code) || 0) + 1);
  }
  const activeSources = (await ensureLeadSources()).filter((source) => source.enabled);
  const knownCodes = new Set(activeSources.map((source) => source.code));
  const newLeadSourceCounts: DailyOpsLeadSourceCount[] = activeSources.map((source) => ({
    code: source.code,
    name: source.name,
    mark: source.mark,
    count: countByCode.get(source.code) || 0,
  }));
  // Ліди з кодом вимкненого/видаленого джерела — у «Не визначено», щоб Загалом збігався.
  for (const [code, count] of countByCode) {
    if (!knownCodes.has(code)) newLeadsUndefinedCount += count;
  }

  return {
    kyivDay,
    newLeadsCount,
    newLeadSourceCounts,
    newLeadsUndefinedCount,
    leadsRecordsCount: countLeadsStatsRecordsOnKyivDay(clients as DirectClient[], kyivDay),
    consultationCreated: today.consultationCreated ?? 0,
    consultationRealized: today.consultationRealized ?? 0,
    newClientsCount: today.newClientsCount ?? 0,
    consultationBookedToday: today.consultationBookedToday ?? 0,
    rebookingsCount: paidCreated.rebookingsCount,
    recordsCreatedCount: paidCreated.recordsCreatedCount,
    recordsRealizedCountToday: today.recordsRealizedCountToday ?? 0,
    turnoverToday: altegioTurnover ?? today.turnoverToday ?? 0,
    incomingUnmatched: bankUnmatched.incomingUnmatched,
    outgoingUnmatched: bankUnmatched.outgoingUnmatched,
    callsIncoming: calls.incoming,
    callsOutgoing: calls.outgoing,
    callsMissed: calls.fail,
    callsMissedNames: incomingMissed.names,
    activeBaseCount: activeBase.activeBaseCount,
    removedFromActiveBaseCount: activeBase.removedFromActiveBaseCount,
    removedFromActiveBaseNames: activeBase.removedFromActiveBaseNames,
    removedFromActiveBaseClientIds: activeBase.removedFromActiveBaseClientIds,
    returnedToActiveBaseCount: activeBase.returnedToActiveBaseCount,
    returnedToActiveBaseNames: activeBase.returnedToActiveBaseNames,
    returnedToActiveBaseClientIds: activeBase.returnedToActiveBaseClientIds,
  };
}
