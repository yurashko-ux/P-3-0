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
  const code = (e as { code?: string })?.code;
  const msg = String((e as Error)?.message || e);
  if (code === 'P2010' || code === 'P2022' || code === '42703') return true;
  if (msg.includes('does not exist') || msg.includes('Undefined column')) return true;
  return false;
}

/** Той самий набір колонок, що очікує Prisma Client для DirectClient. */
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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/e4d350b7-7929-4c21-a27b-c6c6190d2dda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9597f' },
    body: JSON.stringify({
      sessionId: 'd9597f',
      location: 'direct-kyiv-db-columns.ts:kyivDayColumnsExistCached',
      message: 'probe fresh (cold cache)',
      data: { exists: cachedKyivColumnsExist },
      timestamp: Date.now(),
      hypothesisId: 'H-probe-vs-schema',
    }),
  }).catch(() => {});
  // #endregion
  writeGlobalCache(cachedKyivColumnsExist);
  return cachedKyivColumnsExist;
}
