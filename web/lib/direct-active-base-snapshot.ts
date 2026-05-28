// web/lib/direct-active-base-snapshot.ts
// Snapshot активної/неактивної клієнтської бази Direct для історичних графіків.

import { prisma } from '@/lib/prisma';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { isActiveBaseOnKyivDay } from '@/lib/inactive-base/days-since-last-visit';

export type DirectActiveBaseSnapshotPoint = {
  kyivDay: string;
  activeBaseCount: number;
  inactiveBaseCount: number;
  totalClientsCount: number;
  deltaCount?: number;
  addedClientIds?: string[];
  removedClientIds?: string[];
};

export type DirectActiveBaseChartPayload = {
  daily: DirectActiveBaseSnapshotPoint[];
  monthly: Array<DirectActiveBaseSnapshotPoint & { month: string }>;
};

type CalculatedDirectActiveBaseSnapshot = DirectActiveBaseSnapshotPoint & {
  activeClientIds: string[];
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
      if (!existing[0]?.exists) {
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
      }

      const existingMembers = await prisma.$queryRaw<Array<{ exists: string | null }>>`
        SELECT to_regclass('public.direct_active_base_snapshot_members')::text AS "exists"
      `;
      if (!existingMembers[0]?.exists) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "direct_active_base_snapshot_members" (
            "id" TEXT NOT NULL,
            "kyivDay" TEXT NOT NULL,
            "clientId" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "direct_active_base_snapshot_members_pkey" PRIMARY KEY ("id")
          )
        `);
        await prisma.$executeRawUnsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS "direct_active_base_snapshot_members_kyivDay_clientId_key" ON "direct_active_base_snapshot_members"("kyivDay", "clientId")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "direct_active_base_snapshot_members_kyivDay_idx" ON "direct_active_base_snapshot_members"("kyivDay")`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "direct_active_base_snapshot_members_clientId_idx" ON "direct_active_base_snapshot_members"("clientId")`
        );
      }
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

function isActiveBaseForDay(
  client: {
    consultationAttended: boolean | null;
    consultationAttendanceValue: number | null;
    consultationDate: Date | null;
    consultationBookingDate: Date | null;
    paidServiceAttended: boolean | null;
    paidServiceAttendanceValue: number | null;
    paidServiceDate: Date | null;
    lastVisitAt: Date | null;
  },
  snapshotKyivDay: string
): boolean {
  return isActiveBaseOnKyivDay(client, snapshotKyivDay);
}

export async function calculateDirectActiveBaseSnapshot(
  kyivDay: string = getTodayKyiv()
): Promise<CalculatedDirectActiveBaseSnapshot> {
  const normalizedDay = normalizeKyivDay(kyivDay);
  const clients = await prisma.directClient.findMany({
    select: {
      id: true,
      spent: true,
      lastVisitAt: true,
      consultationAttended: true,
      consultationAttendanceValue: true,
      consultationDate: true,
      consultationBookingDate: true,
      paidServiceAttended: true,
      paidServiceAttendanceValue: true,
      paidServiceDate: true,
      paidRecordsInHistoryCount: true,
    },
  });

  let activeBaseCount = 0;
  let inactiveBaseCount = 0;
  const activeClientIds: string[] = [];
  for (const client of clients) {
    if (!hasPaidServiceVisit(client)) {
      continue;
    }
    if (isActiveBaseForDay(client, normalizedDay)) {
      activeBaseCount++;
      activeClientIds.push(client.id);
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
    activeClientIds,
  };
}

export async function captureDirectActiveBaseSnapshot(
  kyivDay: string = getTodayKyiv()
): Promise<DirectActiveBaseSnapshotPoint> {
  await ensureDirectActiveBaseSnapshotTableExists();
  const snapshot = await calculateDirectActiveBaseSnapshot(kyivDay);
  const saved = await prisma.directActiveBaseSnapshot.upsert({
    where: { kyivDay: snapshot.kyivDay },
    create: {
      kyivDay: snapshot.kyivDay,
      activeBaseCount: snapshot.activeBaseCount,
      inactiveBaseCount: snapshot.inactiveBaseCount,
      totalClientsCount: snapshot.totalClientsCount,
    },
    update: {
      activeBaseCount: snapshot.activeBaseCount,
      inactiveBaseCount: snapshot.inactiveBaseCount,
      totalClientsCount: snapshot.totalClientsCount,
    },
  });

  const memberWrites = [
    prisma.directActiveBaseSnapshotMember.deleteMany({
      where: { kyivDay: snapshot.kyivDay },
    }),
  ];
  if (snapshot.activeClientIds.length > 0) {
    memberWrites.push(
      prisma.directActiveBaseSnapshotMember.createMany({
        data: snapshot.activeClientIds.map((clientId) => ({
          kyivDay: snapshot.kyivDay,
          clientId,
        })),
        skipDuplicates: true,
      })
    );
  }
  await prisma.$transaction(memberWrites);

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

  const memberRows = daily.length > 0
    ? await prisma.directActiveBaseSnapshotMember.findMany({
        where: { kyivDay: { in: daily.map((row) => row.kyivDay) } },
        select: { kyivDay: true, clientId: true },
      })
    : [];
  const membersByDay = new Map<string, Set<string>>();
  for (const row of memberRows) {
    const set = membersByDay.get(row.kyivDay) ?? new Set<string>();
    set.add(row.clientId);
    membersByDay.set(row.kyivDay, set);
  }

  const dailyWithDelta = daily.map((point, idx): DirectActiveBaseSnapshotPoint => {
    if (idx === 0) {
      return { ...point, deltaCount: 0, addedClientIds: [], removedClientIds: [] };
    }
    const hasCurrentMembers = membersByDay.has(point.kyivDay);
    const hasPreviousMembers = membersByDay.has(daily[idx - 1].kyivDay);
    if (!hasCurrentMembers || !hasPreviousMembers) {
      return {
        ...point,
        deltaCount: point.activeBaseCount - daily[idx - 1].activeBaseCount,
        addedClientIds: [],
        removedClientIds: [],
      };
    }
    const current = membersByDay.get(point.kyivDay) ?? new Set<string>();
    const previous = membersByDay.get(daily[idx - 1].kyivDay) ?? new Set<string>();
    const addedClientIds = Array.from(current).filter((id) => !previous.has(id));
    const removedClientIds = Array.from(previous).filter((id) => !current.has(id));
    return {
      ...point,
      deltaCount: point.activeBaseCount - daily[idx - 1].activeBaseCount,
      addedClientIds,
      removedClientIds,
    };
  });

  const latestByMonth = new Map<string, DirectActiveBaseSnapshotPoint & { month: string }>();
  for (const point of dailyWithDelta) {
    const month = point.kyivDay.slice(0, 7);
    latestByMonth.set(month, { ...point, month });
  }
  const monthlyBase = Array.from(latestByMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  const monthly = monthlyBase.map((point, idx): DirectActiveBaseSnapshotPoint & { month: string } => {
    if (idx === 0) {
      return { ...point, deltaCount: 0, addedClientIds: [], removedClientIds: [] };
    }
    const previous = monthlyBase[idx - 1];
    const hasCurrentMembers = membersByDay.has(point.kyivDay);
    const hasPreviousMembers = membersByDay.has(previous.kyivDay);
    if (!hasCurrentMembers || !hasPreviousMembers) {
      return {
        ...point,
        deltaCount: point.activeBaseCount - previous.activeBaseCount,
        addedClientIds: [],
        removedClientIds: [],
      };
    }
    const current = membersByDay.get(point.kyivDay) ?? new Set<string>();
    const previousMembers = membersByDay.get(previous.kyivDay) ?? new Set<string>();
    const addedClientIds = Array.from(current).filter((id) => !previousMembers.has(id));
    const removedClientIds = Array.from(previousMembers).filter((id) => !current.has(id));
    return {
      ...point,
      deltaCount: point.activeBaseCount - previous.activeBaseCount,
      addedClientIds,
      removedClientIds,
    };
  });

  return {
    daily: dailyWithDelta,
    monthly,
  };
}

export async function getDirectActiveBaseSnapshotMembers(kyivDay: string): Promise<{
  clientIds: string[];
  hasSavedMembers: boolean;
}> {
  await ensureDirectActiveBaseSnapshotTableExists();
  const rows = await prisma.directActiveBaseSnapshotMember.findMany({
    where: { kyivDay },
    select: { clientId: true },
  });
  return {
    clientIds: rows.map((row) => row.clientId),
    hasSavedMembers: rows.length > 0,
  };
}

export function getCurrentKyivDayForActiveBaseSnapshot(): string {
  return getTodayKyiv();
}
