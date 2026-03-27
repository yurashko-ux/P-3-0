// Єдине джерело кешу *KyivDay + globalThis (Next може дублювати chunk — один кеш на ізолят).
// Перевірка через SELECT реальних колонок (узгоджено з findMany), не лише information_schema.
import type { PrismaClient } from '@prisma/client';

type G = typeof globalThis & { __kyivDayDirectKyivProbeColumnsExist?: boolean };

let cachedKyivColumnsExist: boolean | null = null;

function readGlobalCache(): boolean | undefined {
  return (globalThis as G).__kyivDayDirectKyivProbeColumnsExist;
}

function writeGlobalCache(v: boolean): void {
  (globalThis as G).__kyivDayDirectKyivProbeColumnsExist = v;
}

function isMissingColumnError(e: unknown): boolean {
  const ex = e as { code?: string; meta?: { code?: string; message?: string } };
  const code = String(ex?.code ?? '');
  const metaCode = String(ex?.meta?.code ?? '');
  const msg = String((e as Error)?.message || e);
  if (code === 'P2010' || code === 'P2022' || code === '42703' || metaCode === '42703') return true;
  if (/42703/i.test(msg) || msg.includes('does not exist') || msg.includes('Undefined column')) return true;
  return false;
}

/** Той самий набір колонок, що очікує Prisma Client для DirectClient. Без кешу — для getAllDirectClientsOnce. */
async function probeKyivColumnsExist(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe(
      `SELECT "paidServiceKyivDay", "consultationBookingKyivDay" FROM "direct_clients" LIMIT 1`
    );
    return true;
  } catch (e: unknown) {
    if (isMissingColumnError(e)) {
      return false;
    }
    console.warn(
      '[direct-kyiv-db-columns] probeKyivColumns: неочікувана помилка — безпечний режим (немає колонок)',
      e
    );
    return false;
  }
}

/** Завжди свіжий SELECT (не читає module/global кеш) — узгоджено з findMany. */
export async function probeDirectKyivDayColumnsLive(prisma: PrismaClient): Promise<boolean> {
  return probeKyivColumnsExist(prisma);
}

/** Примусово вирівняти кеш після live-probe (middleware omit). */
export function syncKyivDayColumnExistCache(exists: boolean): void {
  cachedKyivColumnsExist = exists;
  writeGlobalCache(exists);
}

export function invalidateKyivDayColumnCache(): void {
  cachedKyivColumnsExist = null;
  delete (globalThis as G).__kyivDayDirectKyivProbeColumnsExist;
}

/**
 * Чи є в public.direct_clients обидві колонки *KyivDay (кеш на процес / ізолят).
 */
export async function kyivDayColumnsExistCached(prisma: PrismaClient): Promise<boolean> {
  const g = readGlobalCache();
  if (g === true || g === false) {
    cachedKyivColumnsExist = g;
    return g;
  }
  if (cachedKyivColumnsExist !== null) {
    writeGlobalCache(cachedKyivColumnsExist);
    return cachedKyivColumnsExist;
  }
  cachedKyivColumnsExist = await probeKyivColumnsExist(prisma);
  writeGlobalCache(cachedKyivColumnsExist);
  return cachedKyivColumnsExist;
}
