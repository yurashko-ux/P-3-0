// Єдине джерело кешу *KyivDay + globalThis (Next може дублювати chunk — один кеш на ізолят).
import type { PrismaClient } from '@prisma/client';

type G = typeof globalThis & { __kyivDayDirectColumnsCache?: boolean };

let cachedKyivColumnsExist: boolean | null = null;

function readGlobalCache(): boolean | undefined {
  return (globalThis as G).__kyivDayDirectColumnsCache;
}

function writeGlobalCache(v: boolean): void {
  (globalThis as G).__kyivDayDirectColumnsCache = v;
}

export function invalidateKyivDayColumnCache(): void {
  cachedKyivColumnsExist = null;
  delete (globalThis as G).__kyivDayDirectColumnsCache;
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
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
      `SELECT COUNT(*)::int AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'direct_clients'
         AND column_name IN ('paidServiceKyivDay', 'consultationBookingKyivDay')`
    );
    cachedKyivColumnsExist = (rows[0]?.c ?? 0) >= 2;
  } catch {
    cachedKyivColumnsExist = false;
  }
  writeGlobalCache(cachedKyivColumnsExist);
  return cachedKyivColumnsExist;
}
