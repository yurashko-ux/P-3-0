// Попередження про міграцію; перевірка колонок — через direct-kyiv-db-columns (спільний кеш з prisma middleware).
import { prisma } from './prisma';
import { kyivDayColumnsExistCached } from './direct-kyiv-db-columns';

let loggedMissingMigration = false;

export async function directKyivDayColumnsExist(): Promise<boolean> {
  const ok = await kyivDayColumnsExistCached(prisma);
  if (!ok && !loggedMissingMigration) {
    loggedMissingMigration = true;
    console.warn(
      '[direct-booking-kyiv-ensure] Колонки paidServiceKyivDay / consultationBookingKyivDay відсутні в БД. Виконайте prisma migrate deploy під роллю власника (Neon / CI). Runtime ALTER з додатку недоступний (часто 42501).'
    );
  }
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/e4d350b7-7929-4c21-a27b-c6c6190d2dda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9597f' },
    body: JSON.stringify({
      sessionId: 'd9597f',
      location: 'direct-booking-kyiv-ensure.ts:directKyivDayColumnsExist',
      message: 'unified cache',
      data: { ok },
      timestamp: Date.now(),
      hypothesisId: 'H6',
    }),
  }).catch(() => {});
  // #endregion
  return ok;
}

export async function ensureDirectBookingKyivDayColumns(): Promise<void> {
  await directKyivDayColumnsExist();
}
