// Збірка щоденного операційного звіту з існуючих джерел Direct / Binotel / Банк.

import { getAllDirectClients } from "@/lib/direct-store";
import { kvRead } from "@/lib/kv";
import { getTodayKyiv, toKyivDay } from "@/lib/direct-stats-config";
import { computePeriodStats } from "@/lib/direct-period-stats";
import { computeBinotelCallsFilterCountsFromDb } from "@/lib/direct-binotel-filter-counts";
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  pickClosestConsultGroup,
  pickRecordCreatedAtISOFromGroup,
} from "@/lib/altegio/records-grouping";
import { countBankUnmatchedForKyivDay } from "@/lib/reports/bank-unmatched-counts";

export type DailyOpsReportData = {
  kyivDay: string;
  newLeadsCount: number;
  newClientsCount: number;
  consultationCreated: number;
  consultationBookedToday: number;
  consultationRealized: number;
  consultationCancelled: number;
  consultationNoShow: number;
  consultationPlanned: number;
  recordsCreatedCount: number;
  recordsPlannedCountToday: number;
  recordsRealizedCountToday: number;
  turnoverToday: number;
  incomingUnmatched: number;
  outgoingUnmatched: number;
  callsIncoming: number;
  callsOutgoing: number;
  callsMissed: number;
};

function getPaidSum(client: Record<string, unknown>): number {
  const breakdown = Array.isArray(client.paidServiceVisitBreakdown)
    ? client.paidServiceVisitBreakdown
    : null;
  if (breakdown && breakdown.length > 0) {
    return breakdown.reduce(
      (acc: number, b: Record<string, unknown>) => acc + (Number(b?.sumUAH) || 0),
      0,
    );
  }
  const cost = Number(client.paidServiceTotalCost);
  return Number.isFinite(cost) ? cost : 0;
}

async function enrichClientsWithKvConsultCreatedAt<T extends { altegioClientId?: unknown; consultationBookingDate?: unknown; consultationRecordCreatedAt?: unknown }>(
  clients: T[],
): Promise<T[]> {
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

function countRecordsCreatedOnDay(clients: Record<string, unknown>[], kyivDay: string): number {
  let count = 0;
  for (const client of clients) {
    const paidSum = getPaidSum(client);
    if (paidSum <= 0) continue;
    const paidCreatedDay =
      toKyivDay(client.paidServiceRecordCreatedAt as string | null | undefined) ||
      toKyivDay(client.paidServiceDate as string | null | undefined);
    if (paidCreatedDay === kyivDay) count += 1;
  }
  return count;
}

export async function buildDailyOpsReport(options?: {
  kyivDay?: string | null;
}): Promise<DailyOpsReportData> {
  const kyivDay = getTodayKyiv(options?.kyivDay);
  let clients = await getAllDirectClients();
  clients = await enrichClientsWithKvConsultCreatedAt(clients);

  const { today } = computePeriodStats(clients, {
    clientsForBookedStats: clients,
    todayKyiv: kyivDay,
  });

  const [bankUnmatched, calls] = await Promise.all([
    countBankUnmatchedForKyivDay(kyivDay),
    computeBinotelCallsFilterCountsFromDb({ kyivDay }),
  ]);

  return {
    kyivDay,
    newLeadsCount: today.newLeadsCount ?? 0,
    newClientsCount: today.newClientsCount ?? 0,
    consultationCreated: today.consultationCreated ?? 0,
    consultationBookedToday: today.consultationBookedToday ?? 0,
    consultationRealized: today.consultationRealized ?? 0,
    consultationCancelled: today.consultationCancelled ?? 0,
    consultationNoShow: today.consultationNoShow ?? 0,
    consultationPlanned: today.consultationPlanned ?? 0,
    recordsCreatedCount: countRecordsCreatedOnDay(clients as Record<string, unknown>[], kyivDay),
    recordsPlannedCountToday: today.recordsPlannedCountToday ?? 0,
    recordsRealizedCountToday: today.recordsRealizedCountToday ?? 0,
    turnoverToday: today.turnoverToday ?? 0,
    incomingUnmatched: bankUnmatched.incomingUnmatched,
    outgoingUnmatched: bankUnmatched.outgoingUnmatched,
    callsIncoming: calls.incoming,
    callsOutgoing: calls.outgoing,
    callsMissed: calls.fail,
  };
}
