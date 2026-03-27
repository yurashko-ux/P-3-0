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
  return ok;
}

export async function ensureDirectBookingKyivDayColumns(): Promise<void> {
  await directKyivDayColumnsExist();
}
