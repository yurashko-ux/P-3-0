// web/lib/direct-active-base-snapshot.ts
// Snapshot активної/неактивної клієнтської бази Direct для історичних графіків.

import { prisma } from '@/lib/prisma';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

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

function normalizeKyivDay(day?: string | null): string {
  const trimmed = (day || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return getTodayKyiv();
}

function hasPaidServiceVisit(client: {
  paidServiceAttended: boolean | null;
  paidServiceAttendanceValue: number | null;
  paidRecordsInHistoryCount: number | null;
}): boolean {
  return (
    client.paidServiceAttended === true ||
    client.paidServiceAttendanceValue === 1 ||
    Number(client.paidRecordsInHistoryCount ?? 0) > 0
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
