// web/lib/direct-active-base-snapshot.ts
// Snapshot активної/неактивної клієнтської бази Direct для історичних графіків.

import { prisma } from '@/lib/prisma';
import { kyivDayFromISO, type RecordGroup } from '@/lib/altegio/records-grouping';
import {
  loadAllConsultGroupsByClient,
  loadConsultGroupsByAltegioIds,
} from '@/lib/direct-consultation-master-sync';
import {
  ACTIVE_BASE_MAX_DAYS,
  computePaidDaysSinceLastVisitOnKyivDay,
  hasScheduledPaidServiceKeepingActiveBaseOnKyivDay,
  isActiveBaseOnKyivDay,
} from '@/lib/inactive-base/days-since-last-visit';
import { isRestoredByFutureBooking } from '@/lib/inactive-base/lifecycle';
import { listReturnedClientIdsInRange } from '@/lib/inactive-base/lifecycle-events';
import { loadAltegioRecordGroupsForClient } from '@/lib/direct-reconcile-altegio-record-status';

export type DirectActiveBaseSnapshotPoint = {
  kyivDay: string;
  activeBaseCount: number;
  inactiveBaseCount: number;
  totalClientsCount: number;
  deltaCount?: number;
  addedClientIds?: string[];
  removedClientIds?: string[];
  /** Повернуті майбутнім платним записом за період до цього snapshot */
  returnedClientIds?: string[];
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
  altegioClientId: number | null;
  spent: number | null;
  paidServiceAttended: boolean | null;
  paidServiceAttendanceValue: number | null;
  paidServiceDate: Date | null;
  paidServiceKyivDay: string | null;
  paidServiceRecordCreatedAt: Date | null;
  signedUpForPaidService: boolean | null;
  paidRecordsInHistoryCount: number | null;
  lastVisitAt: Date | null;
  consultationAttended: boolean | null;
  consultationAttendanceValue: number | null;
  consultationDate: Date | null;
  consultationBookingDate: Date | null;
  consultationBookingKyivDay: string | null;
  consultationCancelled: boolean | null;
};

const ACTIVE_BASE_CLIENT_SELECT = {
  id: true,
  altegioClientId: true,
  spent: true,
  paidServiceAttended: true,
  paidServiceAttendanceValue: true,
  paidServiceDate: true,
  paidServiceKyivDay: true,
  paidServiceRecordCreatedAt: true,
  signedUpForPaidService: true,
  paidRecordsInHistoryCount: true,
  lastVisitAt: true,
  consultationAttended: true,
  consultationAttendanceValue: true,
  consultationDate: true,
  consultationBookingDate: true,
  consultationBookingKyivDay: true,
  consultationCancelled: true,
} as const;

async function loadActiveBaseClients(): Promise<ActiveBaseClientRow[]> {
  return prisma.directClient.findMany({ select: ACTIVE_BASE_CLIENT_SELECT });
}

/** Історія записів Altegio/KV — той самий джерело, що колонка «Днів» у Direct. */
async function loadRecordGroupsForActiveBaseClients(
  clients: ActiveBaseClientRow[]
): Promise<Map<number, RecordGroup[]>> {
  const altegioIds = [
    ...new Set(
      clients
        .map((c) => Number(c.altegioClientId))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  if (!altegioIds.length) return new Map();
  try {
    if (altegioIds.length <= 150) {
      return await loadConsultGroupsByAltegioIds(altegioIds);
    }
    return await loadAllConsultGroupsByClient();
  } catch (err) {
    console.warn(
      '[direct-active-base-snapshot] Не вдалося завантажити групи Altegio/KV для активної бази:',
      err
    );
    return new Map();
  }
}

function recordGroupsForClient(
  client: ActiveBaseClientRow,
  groupsByAltegioId: Map<number, RecordGroup[]> | undefined
): RecordGroup[] | undefined {
  if (!groupsByAltegioId) return undefined;
  const altegioId = Number(client.altegioClientId);
  if (!Number.isFinite(altegioId) || altegioId <= 0) return undefined;
  return groupsByAltegioId.get(altegioId);
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
  kyivDay: string,
  groupsByAltegioId?: Map<number, RecordGroup[]>
): CalculatedDirectActiveBaseSnapshot {
  const normalizedDay = normalizeKyivDay(kyivDay);
  let activeBaseCount = 0;
  let inactiveBaseCount = 0;
  const activeClientIds: string[] = [];
  for (const client of clients) {
    if (!hasPaidServiceVisit(client)) {
      continue;
    }
    const groups = recordGroupsForClient(client, groupsByAltegioId);
    if (isActiveBaseOnKyivDay(client, normalizedDay, ACTIVE_BASE_MAX_DAYS, groups)) {
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

/**
 * Різниця складів активної бази (повна): хто вибув / хто додався.
 * Це єдине джерело для пілбейджа і списку кліків — без окремого «порогового» фільтра,
 * який раніше розходився з deltaCount = різниця лічильників.
 */
function filterActiveBaseDeltaClientIds(
  prevActiveIds: string[],
  currActiveIds: string[]
): { addedClientIds: string[]; removedClientIds: string[] } {
  const prevSet = new Set(prevActiveIds);
  const currSet = new Set(currActiveIds);
  const removedClientIds = prevActiveIds.filter((id) => !currSet.has(id));
  const addedClientIds = currActiveIds.filter((id) => !prevSet.has(id));
  return { addedClientIds, removedClientIds };
}

/** Хто повернувся в активну базу майбутнім платним записом між prev і curr. */
function collectReturnedByBookingClientIds(
  prevActiveIds: string[],
  currActiveIds: string[],
  currDay: string,
  clientsById: Map<string, ActiveBaseClientRow>,
  groupsByAltegioId: Map<number, RecordGroup[]>
): string[] {
  const prevSet = new Set(prevActiveIds);
  const out: string[] = [];
  for (const id of currActiveIds) {
    if (prevSet.has(id)) continue;
    const client = clientsById.get(id);
    if (!client) continue;
    const groups = recordGroupsForClient(client, groupsByAltegioId) ?? [];
    if (isRestoredByFutureBooking(client, currDay, groups)) {
      out.push(id);
    }
  }
  return out;
}

async function mergeReturnedClientIds(
  computedReturned: string[],
  fromDayExclusive: string,
  toDayInclusive: string
): Promise<string[]> {
  const fromEvents = await listReturnedClientIdsInRange(
    addOneKyivDay(fromDayExclusive),
    toDayInclusive
  );
  return [...new Set([...computedReturned, ...fromEvents])];
}

function addOneKyivDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Прибрати з «вибули» тих, хто на currDay ще в активній базі за Altegio/KV
 * (і за потреби API) або має запланований платний запис — той самий критерій, що список у Direct.
 */
async function refineRemovedClientIdsForDrilldown(
  removedClientIds: string[],
  currDay: string,
  clientsById: Map<string, ActiveBaseClientRow>,
  groupsByAltegioId: Map<number, RecordGroup[]>,
  maxApi = 24
): Promise<string[]> {
  if (!removedClientIds.length) return [];

  const kept: string[] = [];
  let apiUsed = 0;

  for (const id of removedClientIds) {
    const client = clientsById.get(id);
    if (!client) continue;

    if (hasScheduledPaidServiceKeepingActiveBaseOnKyivDay(client, currDay)) {
      continue;
    }

    let groups = recordGroupsForClient(client, groupsByAltegioId) ?? [];
    if (isActiveBaseOnKyivDay(client, currDay, ACTIVE_BASE_MAX_DAYS, groups)) {
      continue;
    }

    const days = computePaidDaysSinceLastVisitOnKyivDay(client, currDay, groups);
    const needsApi =
      apiUsed < maxApi &&
      Number(client.altegioClientId) > 0 &&
      (days === undefined || days > ACTIVE_BASE_MAX_DAYS);

    if (needsApi) {
      const altegioId = Number(client.altegioClientId);
      try {
        const { allGroups } = await loadAltegioRecordGroupsForClient(altegioId, {
          strategy: 'kv-first',
          apiTimeoutMs: 10_000,
        });
        apiUsed += 1;
        groupsByAltegioId.set(altegioId, allGroups);
        groups = allGroups;
        if (isActiveBaseOnKyivDay(client, currDay, ACTIVE_BASE_MAX_DAYS, groups)) {
          continue;
        }
      } catch (err) {
        console.warn('[direct-active-base-snapshot] Altegio refine removed не вдався:', {
          altegioClientId: altegioId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    kept.push(id);
  }

  if (kept.length !== removedClientIds.length) {
    console.log(
      `[direct-active-base-snapshot] Refine «вибули» ${currDay}: було=${removedClientIds.length}, лишилось=${kept.length} (api=${apiUsed})`
    );
  }
  return kept;
}

export async function calculateDirectActiveBaseSnapshot(
  kyivDay: string = getTodayKyiv()
): Promise<CalculatedDirectActiveBaseSnapshot> {
  const clients = await loadActiveBaseClients();
  const groupsByAltegioId = await loadRecordGroupsForActiveBaseClients(clients);
  return calculateDirectActiveBaseSnapshotFromClients(clients, kyivDay, groupsByAltegioId);
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
  groupsByAltegioId: Map<number, RecordGroup[]>;
}> {
  const clients = await loadActiveBaseClients();
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const groupsByAltegioId = await loadRecordGroupsForActiveBaseClients(clients);
  const computed = kyivDays.map((kyivDay) =>
    calculateDirectActiveBaseSnapshotFromClients(clients, kyivDay, groupsByAltegioId)
  );

  const daily = computed.map((point, idx): DirectActiveBaseSnapshotPoint => {
    const base = {
      kyivDay: point.kyivDay,
      activeBaseCount: point.activeBaseCount,
      inactiveBaseCount: point.inactiveBaseCount,
      totalClientsCount: point.totalClientsCount,
    };
    if (idx === 0) {
      return {
        ...base,
        deltaCount: 0,
        addedClientIds: [],
        removedClientIds: [],
        returnedClientIds: [],
      };
    }
    const prev = computed[idx - 1];
    const { addedClientIds, removedClientIds } = filterActiveBaseDeltaClientIds(
      prev.activeClientIds,
      point.activeClientIds
    );
    const returnedClientIds = collectReturnedByBookingClientIds(
      prev.activeClientIds,
      point.activeClientIds,
      point.kyivDay,
      clientsById,
      groupsByAltegioId
    );
    return {
      ...base,
      // Чиста зміна розміру бази (стовпчики). Пілбейдж у UI бере довжину removed/added списку.
      deltaCount: point.activeBaseCount - prev.activeBaseCount,
      addedClientIds,
      removedClientIds,
      returnedClientIds,
    };
  });

  // Уточнити «вибули» для drill-down: KV + обмежений Altegio API (як колонка «Днів» у Direct).
  const refinedDaily: DirectActiveBaseSnapshotPoint[] = [];
  for (let idx = 0; idx < daily.length; idx++) {
    const point = daily[idx]!;
    const prevDay = idx > 0 ? daily[idx - 1]!.kyivDay : point.kyivDay;
    let nextPoint = point;
    if (point.removedClientIds?.length) {
      // API лише для останніх точок (місячний графік і «хвіст» днів), щоб не ганяти Altegio на весь рік.
      const nearEnd = idx >= daily.length - 45;
      const refinedRemoved = await refineRemovedClientIdsForDrilldown(
        point.removedClientIds,
        point.kyivDay,
        clientsById,
        groupsByAltegioId,
        nearEnd ? 24 : 0
      );
      nextPoint = { ...nextPoint, removedClientIds: refinedRemoved };
    }
    if (idx > 0) {
      const mergedReturned = await mergeReturnedClientIds(
        nextPoint.returnedClientIds || [],
        prevDay,
        point.kyivDay
      );
      nextPoint = { ...nextPoint, returnedClientIds: mergedReturned };
    }
    refinedDaily.push(nextPoint);
  }

  return { daily: refinedDaily, computed, clientsById, groupsByAltegioId };
}

async function buildMonthlyFromDaily(
  dailyWithDelta: DirectActiveBaseSnapshotPoint[],
  computed: CalculatedDirectActiveBaseSnapshot[],
  clientsById: Map<string, ActiveBaseClientRow>,
  groupsByAltegioId: Map<number, RecordGroup[]>
): Promise<Array<DirectActiveBaseSnapshotPoint & { month: string }>> {
  const computedByDay = new Map(computed.map((c) => [c.kyivDay, c]));
  const latestByMonth = new Map<string, DirectActiveBaseSnapshotPoint & { month: string }>();
  for (const point of dailyWithDelta) {
    const month = point.kyivDay.slice(0, 7);
    latestByMonth.set(month, { ...point, month });
  }
  const monthlyBase = Array.from(latestByMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  const monthly: Array<DirectActiveBaseSnapshotPoint & { month: string }> = [];

  for (let idx = 0; idx < monthlyBase.length; idx++) {
    const point = monthlyBase[idx]!;
    if (idx === 0) {
      monthly.push({
        ...point,
        deltaCount: 0,
        addedClientIds: [],
        removedClientIds: [],
        returnedClientIds: [],
      });
      continue;
    }
    const previous = monthlyBase[idx - 1]!;
    const prevSnap = computedByDay.get(previous.kyivDay);
    const currSnap = computedByDay.get(point.kyivDay);
    if (!prevSnap || !currSnap) {
      monthly.push({
        ...point,
        deltaCount: point.activeBaseCount - previous.activeBaseCount,
        addedClientIds: [],
        removedClientIds: [],
        returnedClientIds: [],
      });
      continue;
    }
    const { addedClientIds, removedClientIds } = filterActiveBaseDeltaClientIds(
      prevSnap.activeClientIds,
      currSnap.activeClientIds
    );
    // Місячна різниця складів (не денна!) + той самий refine, що для списку в Direct.
    const refinedRemoved = await refineRemovedClientIdsForDrilldown(
      removedClientIds,
      currSnap.kyivDay,
      clientsById,
      groupsByAltegioId,
      32
    );
    const returnedComputed = collectReturnedByBookingClientIds(
      prevSnap.activeClientIds,
      currSnap.activeClientIds,
      currSnap.kyivDay,
      clientsById,
      groupsByAltegioId
    );
    const returnedClientIds = await mergeReturnedClientIds(
      returnedComputed,
      previous.kyivDay,
      currSnap.kyivDay
    );
    monthly.push({
      ...point,
      deltaCount: currSnap.activeBaseCount - prevSnap.activeBaseCount,
      addedClientIds,
      removedClientIds: refinedRemoved,
      returnedClientIds,
    });
  }

  return monthly;
}

export async function computeActiveBaseDayDeltaClientIds(
  prevDay: string,
  currDay: string,
  prevActiveIds: string[],
  currActiveIds: string[]
): Promise<{ addedClientIds: string[]; removedClientIds: string[] }> {
  const clients = await loadActiveBaseClients();
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const groupsByAltegioId = await loadRecordGroupsForActiveBaseClients(clients);
  const { addedClientIds, removedClientIds } = filterActiveBaseDeltaClientIds(
    prevActiveIds,
    currActiveIds
  );
  const refinedRemoved = await refineRemovedClientIdsForDrilldown(
    removedClientIds,
    currDay,
    clientsById,
    groupsByAltegioId,
    24
  );
  return { addedClientIds, removedClientIds: refinedRemoved };
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
  const { daily: dailyWithDelta, computed, clientsById, groupsByAltegioId } =
    kyivDays.length > 0
      ? await buildActiveBaseDailyWithDeltas(kyivDays)
      : {
          daily: [],
          computed: [],
          clientsById: new Map<string, ActiveBaseClientRow>(),
          groupsByAltegioId: new Map<number, RecordGroup[]>(),
        };
  const monthly = await buildMonthlyFromDaily(
    dailyWithDelta,
    computed,
    clientsById,
    groupsByAltegioId
  );

  console.log(
    `[direct-active-base-snapshot] Графік активної бази year=${year}: днів=${dailyWithDelta.length}, місяців=${monthly.length}, Altegio-груп=${groupsByAltegioId.size}`
  );

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
