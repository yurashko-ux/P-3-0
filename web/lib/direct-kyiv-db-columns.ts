// Єдине джерело кешу *KyivDay (без дубля через import() у prisma middleware vs статичний імпорт у route).
import type { PrismaClient } from '@prisma/client';

let cachedKyivColumnsExist: boolean | null = null;

export function invalidateKyivDayColumnCache(): void {
  cachedKyivColumnsExist = null;
}

/**
 * Чи є в public.direct_clients обидві колонки *KyivDay (кеш на процес / ізолят).
 */
export async function kyivDayColumnsExistCached(prisma: PrismaClient): Promise<boolean> {
  if (cachedKyivColumnsExist !== null) return cachedKyivColumnsExist;
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
  return cachedKyivColumnsExist;
}
