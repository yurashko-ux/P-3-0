// Колонки *KyivDay мають з’явитися після prisma migrate deploy (власник БД).
// Runtime ALTER з Vercel/Accelerate часто дає 42501 «must be owner» — не покладаємось на DDL.
import { prisma } from './prisma';

let cachedKyivColumnsExist: boolean | null = null;
let loggedMissingMigration = false;

/**
 * Чи існують обидві денормалізовані колонки в public.direct_clients (кеш на процес).
 */
export async function directKyivDayColumnsExist(): Promise<boolean> {
  if (cachedKyivColumnsExist !== null) return cachedKyivColumnsExist;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
      `SELECT COUNT(*)::int AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'direct_clients'
         AND column_name IN ('paidServiceKyivDay', 'consultationBookingKyivDay')`
    );
    const c = rows[0]?.c ?? 0;
    cachedKyivColumnsExist = c >= 2;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/e4d350b7-7929-4c21-a27b-c6c6190d2dda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9597f' },
      body: JSON.stringify({
        sessionId: 'd9597f',
        location: 'direct-booking-kyiv-ensure.ts:directKyivDayColumnsExist',
        message: 'information_schema check',
        data: { count: c, exists: cachedKyivColumnsExist },
        timestamp: Date.now(),
        hypothesisId: 'H5',
      }),
    }).catch(() => {});
    // #endregion
  } catch (e) {
    console.warn('[direct-booking-kyiv-ensure] directKyivDayColumnsExist:', e);
    cachedKyivColumnsExist = false;
  }
  if (cachedKyivColumnsExist === false && !loggedMissingMigration) {
    loggedMissingMigration = true;
    console.warn(
      '[direct-booking-kyiv-ensure] Колонки paidServiceKyivDay / consultationBookingKyivDay відсутні в БД. Виконайте prisma migrate deploy під роллю власника (Neon / CI). Runtime ALTER з додатку недоступний (часто 42501).'
    );
  }
  return cachedKyivColumnsExist;
}

/**
 * Сумісність зі старими імпортами: лише перевірка через information_schema, без ALTER.
 */
export async function ensureDirectBookingKyivDayColumns(): Promise<void> {
  await directKyivDayColumnsExist();
}
