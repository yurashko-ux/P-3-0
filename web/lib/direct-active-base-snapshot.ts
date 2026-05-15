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

// До цієї дати в БД могли бути технічні backfill-точки без повного журналу Altegio.
// Графіки показують лише реальні щоденні snapshot'и, починаючи з запуску збору.
export const DIRECT_ACTIVE_BASE_SNAPSHOT_START_DAY = '2026-05-15';

let snapshotTableEnsurePromise: Promise<void> | null = null;

async function ensureDirectActiveBaseSnapshotTableExists(): Promise<void> {
  if (!snapshotTableEnsurePromise) {
    snapshotTableEnsurePromise = (async () => {
      const existing = await prisma.$queryRaw<Array<{ exists: string | null }>>`
        SELECT to_regclass('public.direct_active_base_snapshots')::text AS "exists"
      `;
      if (existing[0]?.exists) {
        return;
      }

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "direct_active_base_snapshots" (
          "id" TEXT NOT NULL,
          "kyivDay" TEXT NOT NULL,
          "activeBaseCount" INTEGER NOT NULL,
          "inactiveBaseCount" INTEGER NOT NULL,
          "totalClientsCount" INTEGER NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "direct_active_base_snapshots_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "direct_active_base_snapshots_kyivDay_key" ON "direct_active_base_snapshots"("kyivDay")`
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "direct_active_base_snapshots_kyivDay_idx" ON "direct_active_base_snapshots"("kyivDay")`
      );
    })().catch((err) => {
      snapshotTableEnsurePromise = null;
      throw err;
    });
  }
  return snapshotTableEnsurePromise;
}

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
  await ensureDirectActiveBaseSnapshotTableExists();
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
  await ensureDirectActiveBaseSnapshotTableExists();
  const todayKyiv = getTodayKyiv();
  const startDay = String(year) === DIRECT_ACTIVE_BASE_SNAPSHOT_START_DAY.slice(0, 4)
    ? DIRECT_ACTIVE_BASE_SNAPSHOT_START_DAY
    : `${year}-01-01`;
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
