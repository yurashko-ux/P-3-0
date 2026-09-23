// web/lib/inactive-base/lifecycle-events.ts
// Запис / читання подій entered|restored для історії та статистики.

import { prisma } from '@/lib/prisma';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import {
  inactiveSinceKyivDay,
  isCurrentlyInactive,
  isRestoredByFutureBooking,
  restoredAtKyivDay,
  type LifecycleClient,
} from '@/lib/inactive-base/lifecycle';

export type InactiveLifecycleEventType = 'entered' | 'restored';

export type InactiveLifecycleEventRow = {
  id: string;
  clientId: string;
  type: InactiveLifecycleEventType;
  kyivDay: string;
  source: string | null;
  metadata: string | null;
  createdAt: string;
};

async function ensureTable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "direct_inactive_lifecycle_events" LIMIT 1`;
  } catch {
    console.log('[inactive-lifecycle] Створюємо таблицю direct_inactive_lifecycle_events…');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "direct_inactive_lifecycle_events" (
        "id" TEXT NOT NULL,
        "clientId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "kyivDay" TEXT NOT NULL,
        "source" TEXT,
        "metadata" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "direct_inactive_lifecycle_events_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "direct_inactive_lifecycle_events_clientId_type_kyivDay_key"
        ON "direct_inactive_lifecycle_events"("clientId", "type", "kyivDay")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "direct_inactive_lifecycle_events_clientId_idx"
        ON "direct_inactive_lifecycle_events"("clientId")
    `);
  }
}

export async function recordInactiveLifecycleEvent(params: {
  clientId: string;
  type: InactiveLifecycleEventType;
  kyivDay: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const day = (params.kyivDay || '').trim();
  if (!params.clientId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  try {
    await ensureTable();
    await prisma.directInactiveLifecycleEvent.upsert({
      where: {
        clientId_type_kyivDay: {
          clientId: params.clientId,
          type: params.type,
          kyivDay: day,
        },
      },
      create: {
        clientId: params.clientId,
        type: params.type,
        kyivDay: day,
        source: params.source ?? null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
      update: {
        source: params.source ?? null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
      },
    });
  } catch (err) {
    console.warn(
      '[inactive-lifecycle] Не вдалося записати подію:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Синхронізує стан клієнта з lifecycle: inactive / restored + події.
 * Після attended платного візиту не чіпаємо (повертає null — хай визначає determineStateFromServices).
 */
export async function syncInactiveLifecycleForClient(
  clientId: string,
  client: LifecycleClient,
  opts?: { todayKyiv?: string; source?: string; forceStateUpdate?: boolean }
): Promise<'inactive' | 'restored' | null> {
  const today =
    opts?.todayKyiv ||
    kyivDayFromISO(new Date().toISOString());

  // Якщо вже був візит (attended) після restore — не нав'язуємо restored/inactive
  if (
    client.paidServiceAttended === true &&
    client.paidServiceDate &&
    (() => {
      const day =
        (client.paidServiceKyivDay || '').trim() ||
        kyivDayFromISO(
          typeof client.paidServiceDate === 'string'
            ? client.paidServiceDate
            : client.paidServiceDate.toISOString()
        );
      return day && day <= today;
    })()
  ) {
    // Візит уже відбувся — lifecycle-стан знімаємо тільки якщо був restored/inactive
    return null;
  }

  if (isRestoredByFutureBooking(client, today)) {
    const restoredAt = restoredAtKyivDay(client) || today;
    await recordInactiveLifecycleEvent({
      clientId,
      type: 'restored',
      kyivDay: restoredAt,
      source: opts?.source || 'sync',
    });
    const inactiveSince = inactiveSinceKyivDay(client, today);
    if (inactiveSince && inactiveSince <= today) {
      await recordInactiveLifecycleEvent({
        clientId,
        type: 'entered',
        kyivDay: inactiveSince,
        source: opts?.source || 'sync',
      });
    }
    return 'restored';
  }

  if (isCurrentlyInactive(client, today)) {
    const inactiveSince = inactiveSinceKyivDay(client, today) || today;
    await recordInactiveLifecycleEvent({
      clientId,
      type: 'entered',
      kyivDay: inactiveSince,
      source: opts?.source || 'sync',
    });
    return 'inactive';
  }

  return null;
}

export async function listInactiveLifecycleEventsForClient(
  clientId: string
): Promise<InactiveLifecycleEventRow[]> {
  try {
    await ensureTable();
    const rows = await prisma.directInactiveLifecycleEvent.findMany({
      where: { clientId },
      orderBy: [{ kyivDay: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      type: r.type as InactiveLifecycleEventType,
      kyivDay: r.kyivDay,
      source: r.source,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    console.warn(
      '[inactive-lifecycle] list failed:',
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** Повернуті за період [fromDay, toDay] включно (події restored). */
export async function listReturnedClientIdsInRange(
  fromDay: string,
  toDay: string
): Promise<string[]> {
  try {
    await ensureTable();
    const rows = await prisma.directInactiveLifecycleEvent.findMany({
      where: {
        type: 'restored',
        kyivDay: { gte: fromDay, lte: toDay },
      },
      select: { clientId: true },
      distinct: ['clientId'],
    });
    return rows.map((r) => r.clientId);
  } catch {
    return [];
  }
}
