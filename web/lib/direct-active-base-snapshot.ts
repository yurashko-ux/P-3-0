// web/lib/direct-active-base-snapshot.ts
// Snapshot активної/неактивної клієнтської бази Direct для історичних графіків.

import { prisma } from '@/lib/prisma';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import {
  didJoinActiveBaseByThreshold,
  didLeaveActiveBaseByThreshold,
  isActiveBaseOnKyivDay,
} from '@/lib/inactive-base/days-since-last-visit';

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

type ActiveBaseClientRow = {
  id: string;
  spent: number | null;
  lastVisitAt: Date | null;
  consultationAttended: boolean | null;
  consultationAttendanceValue: number | null;
  consultationDate: Date | null;
  consultationBookingDate: Date | null;
  consultationBookingKyivDay: string | null;
  consultationCancelled: boolean | null;
  paidServiceAttended: boolean | null;
  paidServiceAttendanceValue: number | null;
  paidServiceDate: Date | null;
  paidServiceKyivDay: string | null;
  signedUpForPaidService: boolean | null;
  paidRecordsInHistoryCount: number | null;
};

const ACTIVE_BASE_CLIENT_SELECT = {
  id: true,
  spent: true,
  lastVisitAt: true,
  consultationAttended: true,
  consultationAttendanceValue: true,
  consultationDate: true,
  consultationBookingDate: true,
  consultationBookingKyivDay: true,
  consultationCancelled: true,
  paidServiceAttended: true,
  paidServiceAttendanceValue: true,
  paidServiceDate: true,
  paidServiceKyivDay: true,
  signedUpForPaidService: true,
  paidRecordsInHistoryCount: true,
} as const;

async function loadActiveBaseClients(): Promise<ActiveBaseClientRow[]> {
  return prisma.directClient.findMany({ select: ACTIVE_BASE_CLIENT_SELECT });
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

function calculateDirectActiveBaseSnapshotFromClients(
  clients: ActiveBaseClientRow[],
  kyivDay: string
): CalculatedDirectActiveBaseSnapshot {
  const normalizedDay = normalizeKyivDay(kyivDay);
  let activeBaseCount = 0;
  let inactiveBaseCount = 0;
  const activeClientIds: string[] = [];
  for (const client of clients) {
    if (!hasPaidServiceVisit(client)) {
      continue;
    }
    if (isActiveBaseOnKyivDay(client, normalizedDay)) {
      activeBaseCount++;
      activeClientIds.push(client.id);
    } else {
      inactiveBaseCount++;
    }
  }

  return {
    kyivDay: normalizedDay,
    activeBaseCount,
    inactiveBaseCount,
    totalClientsCount: activeBaseCount + inactiveBaseCount,
    activeClientIds,
  };
}

function filterActiveBaseDeltaClientIds(
  prevDay: string,
  currDay: string,
  prevActiveIds: string[],
  currActiveIds: string[],
  clientsById: Map<string, ActiveBaseClientRow>
): { addedClientIds: string[]; removedClientIds: string[] } {
  const prevSet = new Set(prevActiveIds);
  const currSet = new Set(currActiveIds);
  const removedClientIds = prevActiveIds.filter((id) => {
    if (currSet.has(id)) return false;
    const client = clientsById.get(id);
    return client ? didLeaveActiveBaseByThreshold(client, prevDay, currDay) : false;
  });
  const addedClientIds = currActiveIds.filter((id) => {
    if (prevSet.has(id)) return false;
    const client = clientsById.get(id);
    return client ? didJoinActiveBaseByThreshold(client, prevDay, currDay) : false;
  });
  return { addedClientIds, removedClientIds };
}

export async function calculateDirectActiveBaseSnapshot(
  kyivDay: string = getTodayKyiv()
): Promise<CalculatedDirectActiveBaseSnapshot> {
  const clients = await loadActiveBaseClients();
  return calculateDirectActiveBaseSnapshotFromClients(clients, kyivDay);
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

/** Перерахунок snapshot за актуальною логікою (не зі збережених members у БД). */
async function buildActiveBaseDailyWithDeltas(kyivDays: string[]): Promise<{
  daily: DirectActiveBaseSnapshotPoint[];
  computed: CalculatedDirectActiveBaseSnapshot[];
  clientsById: Map<string, ActiveBaseClientRow>;
}> {
  const clients = await loadActiveBaseClients();
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const computed = kyivDays.map((kyivDay) => calculateDirectActiveBaseSnapshotFromClients(clients, kyivDay));

  const daily = computed.map((point, idx): DirectActiveBaseSnapshotPoint => {
    const base = {
      kyivDay: point.kyivDay,
      activeBaseCount: point.activeBaseCount,
      inactiveBaseCount: point.inactiveBaseCount,
      totalClientsCount: point.totalClientsCount,
    };
    if (idx === 0) {
      return { ...base, deltaCount: 0, addedClientIds: [], removedClientIds: [] };
    }
    const prev = computed[idx - 1];
    const { addedClientIds, removedClientIds } = filterActiveBaseDeltaClientIds(
      prev.kyivDay,
      point.kyivDay,
      prev.activeClientIds,
      point.activeClientIds,
      clientsById
    );
    return {
      ...base,
      deltaCount: point.activeBaseCount - prev.activeBaseCount,
      addedClientIds,
      removedClientIds,
    };
  });

  return { daily, computed, clientsById };
}

function buildMonthlyFromDaily(
  dailyWithDelta: DirectActiveBaseSnapshotPoint[],
  computed: CalculatedDirectActiveBaseSnapshot[],
  clientsById: Map<string, ActiveBaseClientRow>
): Array<DirectActiveBaseSnapshotPoint & { month: string }> {
  const computedByDay = new Map(computed.map((c) => [c.kyivDay, c]));
  const latestByMonth = new Map<string, DirectActiveBaseSnapshotPoint & { month: string }>();
  for (const point of dailyWithDelta) {
    const month = point.kyivDay.slice(0, 7);
    latestByMonth.set(month, { ...point, month });
  }
  const monthlyBase = Array.from(latestByMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  return monthlyBase.map((point, idx): DirectActiveBaseSnapshotPoint & { month: string } => {
    if (idx === 0) {
      return { ...point, deltaCount: 0, addedClientIds: [], removedClientIds: [] };
    }
    const previous = monthlyBase[idx - 1];
    const prevSnap = computedByDay.get(previous.kyivDay);
    const currSnap = computedByDay.get(point.kyivDay);
    if (!prevSnap || !currSnap) {
      return {
        ...point,
        deltaCount: point.activeBaseCount - previous.activeBaseCount,
        addedClientIds: [],
        removedClientIds: [],
      };
    }
    const { addedClientIds, removedClientIds } = filterActiveBaseDeltaClientIds(
      prevSnap.kyivDay,
      currSnap.kyivDay,
      prevSnap.activeClientIds,
      currSnap.activeClientIds,
      clientsById
    );
    return {
      ...point,
      deltaCount: currSnap.activeBaseCount - prevSnap.activeBaseCount,
      addedClientIds,
      removedClientIds,
    };
  });
}

export async function computeActiveBaseDayDeltaClientIds(
  prevDay: string,
  currDay: string,
  prevActiveIds: string[],
  currActiveIds: string[]
): Promise<{ addedClientIds: string[]; removedClientIds: string[] }> {
  const clients = await loadActiveBaseClients();
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  return filterActiveBaseDeltaClientIds(prevDay, currDay, prevActiveIds, currActiveIds, clientsById);
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

  const kyivDays = rows.map((row) => row.kyivDay);
  const { daily: dailyWithDelta, computed, clientsById } =
    kyivDays.length > 0
      ? await buildActiveBaseDailyWithDeltas(kyivDays)
      : { daily: [], computed: [], clientsById: new Map<string, ActiveBaseClientRow>() };
  const monthly = buildMonthlyFromDaily(dailyWithDelta, computed, clientsById);

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
