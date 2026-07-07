// Збірка щоденного операційного звіту з існуючих джерел Direct / Binotel / Банк.

import { getAllDirectClients } from "@/lib/direct-store";
import { kvRead } from "@/lib/kv";
import { getTodayKyiv } from "@/lib/direct-stats-config";
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

export type DailyOpsReportData = {
  kyivDay: string;
  newLeadsCount: number;
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
  forecastTurnoverToMonthEnd: number;
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
  const { today, future } = periodStats;

  const [bankUnmatched, calls, activeBase, incomingMissed] = await Promise.all([
    countBankUnmatchedForKyivDay(kyivDay),
    computeBinotelCallsFilterCountsFromDb({ kyivDay }),
    getActiveBaseDailyMetrics(kyivDay),
    getBinotelIncomingMissedOnKyivDay(kyivDay),
  ]);

  return {
    kyivDay,
    newLeadsCount: today.newLeadsCount ?? 0,
    leadsRecordsCount: countLeadsStatsRecordsOnKyivDay(clients as DirectClient[], kyivDay),
    consultationCreated: today.consultationCreated ?? 0,
    consultationRealized: today.consultationRealized ?? 0,
    newClientsCount: today.newClientsCount ?? 0,
    consultationBookedToday: today.consultationBookedToday ?? 0,
    rebookingsCount: today.rebookingsCount ?? 0,
    recordsCreatedCount: countF4RecordsCreatedOnDay(clients as DirectClient[], kyivDay),
    recordsRealizedCountToday: today.recordsRealizedCountToday ?? 0,
    turnoverToday: today.turnoverToday ?? 0,
    incomingUnmatched: bankUnmatched.incomingUnmatched,
    outgoingUnmatched: bankUnmatched.outgoingUnmatched,
    callsIncoming: calls.incoming,
    callsOutgoing: calls.outgoing,
    callsMissed: calls.fail,
    callsMissedNames: incomingMissed.names,
    activeBaseCount: activeBase.activeBaseCount,
    removedFromActiveBaseCount: activeBase.removedFromActiveBaseCount,
    removedFromActiveBaseNames: activeBase.removedFromActiveBaseNames,
    forecastTurnoverToMonthEnd: future.plannedPaidSumToMonthEnd ?? 0,
  };
}
