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
  countF4RecordsCreatedOnDay,
  getActiveBaseDailyMetrics,
  getBinotelIncomingMissedOnKyivDay,
} from "@/lib/reports/daily-ops-extras";
import type { DirectClient } from "@/lib/direct-types";
import { countLeadsStatsRecordsOnKyivDay } from "@/lib/direct-leads-stats-filters";
import { fetchFinanceSummary } from "@/lib/altegio/analytics";
import { leadInstagramLink, type LeadInstagramLink } from "@/lib/reports/lead-instagram-links";

export type DailyOpsReportData = {
  kyivDay: string;
  newLeadsCount: number;
  /** Нові ліди з серцем (agency_2, Агенція 1). */
  newLeadsAgency1Count: number;
  newLeadsAgency1Links: LeadInstagramLink[];
  /** Нові ліди зі зірочкою (agency_1, Агенція 2). */
  newLeadsAgency2Count: number;
  newLeadsAgency2Links: LeadInstagramLink[];
  /** Нові ліди без знака агенції. Решта офіційного newLeadsCount після двох агенцій. */
  newLeadsOrganicCount: number;
  newLeadsOrganicLinks: LeadInstagramLink[];
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

  const newLeadsCount = today.newLeadsCount ?? 0;
  const heartRows: Array<LeadInstagramLink & { sortKey: string }> = [];
  const starRows: Array<LeadInstagramLink & { sortKey: string }> = [];
  const organicRows: Array<LeadInstagramLink & { sortKey: string }> = [];
  for (const client of clients) {
    if (!clientCountsTowardNewLeadsKpi(client)) continue;
    if (toKyivDay(client.firstContactDate) !== kyivDay) continue;
    const link = leadInstagramLink(client);
    if (client.leadAgency === "agency_2") heartRows.push(link);
    else if (client.leadAgency === "agency_1") starRows.push(link);
    else organicRows.push(link);
  }
  const newLeadsAgency2Count = Math.min(starRows.length, newLeadsCount);
  const newLeadsAgency1Count = Math.min(
    heartRows.length,
    Math.max(0, newLeadsCount - newLeadsAgency2Count),
  );
  const newLeadsOrganicCount = Math.max(0, newLeadsCount - newLeadsAgency2Count - newLeadsAgency1Count);
  const takeLeadLinks = (
    rows: Array<LeadInstagramLink & { sortKey: string }>,
    count: number,
  ): LeadInstagramLink[] =>
    rows
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .slice(0, Math.max(0, count))
      .map(({ username, href }) => ({ username, href }));

  return {
    kyivDay,
    newLeadsCount,
    newLeadsAgency1Count,
    newLeadsAgency1Links: takeLeadLinks(heartRows, newLeadsAgency1Count),
    newLeadsAgency2Count,
    newLeadsAgency2Links: takeLeadLinks(starRows, newLeadsAgency2Count),
    newLeadsOrganicCount,
    newLeadsOrganicLinks: takeLeadLinks(organicRows, newLeadsOrganicCount),
    leadsRecordsCount: countLeadsStatsRecordsOnKyivDay(clients as DirectClient[], kyivDay),
    consultationCreated: today.consultationCreated ?? 0,
    consultationRealized: today.consultationRealized ?? 0,
    newClientsCount: today.newClientsCount ?? 0,
    consultationBookedToday: today.consultationBookedToday ?? 0,
    rebookingsCount: today.rebookingsCount ?? 0,
    recordsCreatedCount: countF4RecordsCreatedOnDay(clients as DirectClient[], kyivDay),
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
