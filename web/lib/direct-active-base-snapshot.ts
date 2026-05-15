// web/lib/direct-active-base-snapshot.ts
// Snapshot активної/неактивної клієнтської бази Direct для історичних графіків.

import { prisma } from '@/lib/prisma';
import {
  groupRecordsByClientDay,
  kyivDayFromISO,
  normalizeRecordsLogItems,
} from '@/lib/altegio/records-grouping';
import { kvRead } from '@/lib/kv';

export type DirectActiveBaseSnapshotPoint = {
  kyivDay: string;
  activeBaseCount: number;
  inactiveBaseCount: number;
  totalClientsCount: number;
};

export type DirectActiveBaseChartPayload = {
  daily: DirectActiveBaseSnapshotPoint[];
  monthly: Array<DirectActiveBaseSnapshotPoint & { month: string }>;
};

function getTodayKyiv(): string {
  return kyivDayFromISO(new Date().toISOString());
}

function dayIndexFromKyivDay(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || '').trim());
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return NaN;
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

function kyivDayFromDayIndex(dayIndex: number): string {
  return new Date(dayIndex * 86400000).toISOString().slice(0, 10);
}

function normalizeKyivDay(day?: string | null): string {
  const trimmed = (day || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return getTodayKyiv();
}

function uniqueSortedDays(days: string[]): string[] {
  return Array.from(new Set(days.filter((d) => Number.isFinite(dayIndexFromKyivDay(d))))).sort();
}

function lastDayOnOrBefore(days: string[], day: string): string | null {
  let best: string | null = null;
  for (const d of days) {
    if (d > day) break;
    best = d;
  }
  return best;
}

function hasDayOnOrBefore(days: string[], day: string): boolean {
  for (const d of days) {
    if (d <= day) return true;
    if (d > day) return false;
  }
  return false;
}

function hasPaidServiceVisit(client: {
  spent: number | null;
  paidServiceAttended: boolean | null;
  paidServiceAttendanceValue: number | null;
  paidRecordsInHistoryCount: number | null;
}): boolean {
  const spent = Number(client.spent ?? 0);
  return (
    client.paidServiceAttended === true ||
    client.paidServiceAttendanceValue === 1 ||
    Number(client.paidRecordsInHistoryCount ?? 0) > 0 ||
    spent > 0
  );
}

function isActiveBaseForDay(lastVisitAt: Date | null, snapshotKyivDay: string): boolean {
  if (!lastVisitAt) return false;
  const snapshotIdx = dayIndexFromKyivDay(snapshotKyivDay);
  const lastVisitIdx = dayIndexFromKyivDay(kyivDayFromISO(lastVisitAt.toISOString()));
  if (!Number.isFinite(snapshotIdx) || !Number.isFinite(lastVisitIdx)) return false;
  const diff = snapshotIdx - lastVisitIdx;
  const daysSinceLastVisit = diff < 0 ? 0 : diff;
  return daysSinceLastVisit >= 0 && daysSinceLastVisit <= 100;
}

export async function calculateDirectActiveBaseSnapshot(
  kyivDay: string = getTodayKyiv()
): Promise<DirectActiveBaseSnapshotPoint> {
  const normalizedDay = normalizeKyivDay(kyivDay);
  const clients = await prisma.directClient.findMany({
    select: {
      id: true,
      spent: true,
      lastVisitAt: true,
      paidServiceAttended: true,
      paidServiceAttendanceValue: true,
      paidRecordsInHistoryCount: true,
    },
  });

  let activeBaseCount = 0;
  let inactiveBaseCount = 0;
  for (const client of clients) {
    if (!hasPaidServiceVisit(client)) {
      continue;
    }
    if (isActiveBaseForDay(client.lastVisitAt, normalizedDay)) {
      activeBaseCount++;
    } else {
      inactiveBaseCount++;
    }
  }

  const totalClientsCount = activeBaseCount + inactiveBaseCount;
  return {
    kyivDay: normalizedDay,
    activeBaseCount,
    inactiveBaseCount,
    totalClientsCount,
  };
}

export async function captureDirectActiveBaseSnapshot(
  kyivDay: string = getTodayKyiv()
): Promise<DirectActiveBaseSnapshotPoint> {
  const snapshot = await calculateDirectActiveBaseSnapshot(kyivDay);
  const saved = await prisma.directActiveBaseSnapshot.upsert({
    where: { kyivDay: snapshot.kyivDay },
    create: snapshot,
    update: {
      activeBaseCount: snapshot.activeBaseCount,
      inactiveBaseCount: snapshot.inactiveBaseCount,
      totalClientsCount: snapshot.totalClientsCount,
    },
  });

  return {
    kyivDay: saved.kyivDay,
    activeBaseCount: saved.activeBaseCount,
    inactiveBaseCount: saved.inactiveBaseCount,
    totalClientsCount: saved.totalClientsCount,
  };
}

export async function backfillDirectActiveBaseSnapshotsFromExistingData(
  year: number = Number(getTodayKyiv().slice(0, 4))
): Promise<{ created: number; skippedExisting: number; sourceEvents: number }> {
  const todayKyiv = getTodayKyiv();
  const currentYear = Number(todayKyiv.slice(0, 4));
  if (!Number.isInteger(year) || year < 2024 || year > currentYear) {
    return { created: 0, skippedExisting: 0, sourceEvents: 0 };
  }

  const startDay = `${year}-01-01`;
  const endDay = year === currentYear ? kyivDayFromDayIndex(dayIndexFromKyivDay(todayKyiv) - 1) : `${year}-12-31`;
  const startIdx = dayIndexFromKyivDay(startDay);
  const endIdx = dayIndexFromKyivDay(endDay);
  if (!Number.isFinite(startIdx) || !Number.isFinite(endIdx) || endIdx < startIdx) {
    return { created: 0, skippedExisting: 0, sourceEvents: 0 };
  }

  const existingRows = await prisma.directActiveBaseSnapshot.findMany({
    where: { kyivDay: { gte: startDay, lte: endDay } },
    select: { kyivDay: true },
  });
  const existingDays = new Set(existingRows.map((r) => r.kyivDay));

  const clients = await prisma.directClient.findMany({
    select: {
      id: true,
      altegioClientId: true,
      spent: true,
      lastVisitAt: true,
      consultationAttended: true,
      consultationAttendanceValue: true,
      consultationDate: true,
      consultationBookingDate: true,
      paidServiceDate: true,
      paidServiceAttended: true,
      paidServiceAttendanceValue: true,
      paidRecordsInHistoryCount: true,
    },
  });

  const [rawRecords, rawWebhooks] = await Promise.all([
    kvRead.lrange('altegio:records:log', 0, 49999).catch(() => []),
    kvRead.lrange('altegio:webhook:log', 0, 9999).catch(() => []),
  ]);
  const normalizedEvents = normalizeRecordsLogItems([...rawRecords, ...rawWebhooks]);
  const groupsByClient = groupRecordsByClientDay(normalizedEvents);

  const histories = clients.map((client) => {
    const visitDays: string[] = [];
    const paidDays: string[] = [];

    if (client.altegioClientId) {
      const groups = groupsByClient.get(client.altegioClientId) || [];
      for (const group of groups) {
        if (group.attendance !== 1) continue;
        if (!Number.isFinite(dayIndexFromKyivDay(group.kyivDay))) continue;
        visitDays.push(group.kyivDay);
        if (group.groupType === 'paid') {
          paidDays.push(group.kyivDay);
        }
      }
    }

    if (client.consultationAttended === true && client.consultationAttendanceValue === 1) {
      const d = client.consultationDate ?? client.consultationBookingDate;
      if (d) visitDays.push(kyivDayFromISO(d.toISOString()));
    }

    if (client.lastVisitAt) {
      visitDays.push(kyivDayFromISO(client.lastVisitAt.toISOString()));
    }

    if (hasPaidServiceVisit(client)) {
      const paidDay = client.paidServiceDate
        ? kyivDayFromISO(client.paidServiceDate.toISOString())
        : client.lastVisitAt
          ? kyivDayFromISO(client.lastVisitAt.toISOString())
          : '';
      if (paidDay) paidDays.push(paidDay);
    }

    return {
      visitDays: uniqueSortedDays(visitDays),
      paidDays: uniqueSortedDays(paidDays),
    };
  });

  const rows: DirectActiveBaseSnapshotPoint[] = [];
  let skippedExisting = 0;
  for (let idx = startIdx; idx <= endIdx; idx++) {
    const kyivDay = kyivDayFromDayIndex(idx);
    if (existingDays.has(kyivDay)) {
      skippedExisting++;
      continue;
    }

    let activeBaseCount = 0;
    let inactiveBaseCount = 0;
    for (const h of histories) {
      if (!hasDayOnOrBefore(h.paidDays, kyivDay)) continue;
      const lastVisitDay = lastDayOnOrBefore(h.visitDays, kyivDay);
      if (!lastVisitDay) {
        inactiveBaseCount++;
        continue;
      }
      const diff = idx - dayIndexFromKyivDay(lastVisitDay);
      if (diff >= 0 && diff <= 100) activeBaseCount++;
      else inactiveBaseCount++;
    }

    rows.push({
      kyivDay,
      activeBaseCount,
      inactiveBaseCount,
      totalClientsCount: activeBaseCount + inactiveBaseCount,
    });
  }

  if (rows.length > 0) {
    const result = await prisma.directActiveBaseSnapshot.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return { created: result.count, skippedExisting, sourceEvents: normalizedEvents.length };
  }

  return { created: 0, skippedExisting, sourceEvents: normalizedEvents.length };
}

export async function getDirectActiveBaseChartPayload(
  year: number = Number(getTodayKyiv().slice(0, 4))
): Promise<DirectActiveBaseChartPayload> {
  const todayKyiv = getTodayKyiv();
  const startDay = `${year}-01-01`;
  const endDay = String(year) === todayKyiv.slice(0, 4) ? todayKyiv : `${year}-12-31`;

  const rows = await prisma.directActiveBaseSnapshot.findMany({
    where: {
      kyivDay: {
        gte: startDay,
        lte: endDay,
      },
    },
    orderBy: { kyivDay: 'asc' },
  });

  const daily = rows.map((row) => ({
    kyivDay: row.kyivDay,
    activeBaseCount: row.activeBaseCount,
    inactiveBaseCount: row.inactiveBaseCount,
    totalClientsCount: row.totalClientsCount,
  }));

  const latestByMonth = new Map<string, DirectActiveBaseSnapshotPoint & { month: string }>();
  for (const point of daily) {
    const month = point.kyivDay.slice(0, 7);
    latestByMonth.set(month, { ...point, month });
  }

  return {
    daily,
    monthly: Array.from(latestByMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export function getCurrentKyivDayForActiveBaseSnapshot(): string {
  return getTodayKyiv();
}
