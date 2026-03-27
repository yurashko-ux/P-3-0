// Ідемпотентне створення колонок *KyivDay, якщо міграція ще не на БД (будь-який шлях: Binotel, вебхуки тощо).
import { prisma } from './prisma';

let directBookingKyivColumnsReady = false;

export async function ensureDirectBookingKyivDayColumns(): Promise<void> {
  if (directBookingKyivColumnsReady) return;
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "consultationBookingKyivDay" TEXT;`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "paidServiceKyivDay" TEXT;`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "direct_clients_consultationBookingKyivDay_idx" ON "direct_clients" ("consultationBookingKyivDay");`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "direct_clients_paidServiceKyivDay_idx" ON "direct_clients" ("paidServiceKyivDay");`
    );
    await prisma.$executeRawUnsafe(`
      UPDATE "direct_clients"
      SET "consultationBookingKyivDay" = to_char(timezone('Europe/Kyiv', "consultationBookingDate"), 'YYYY-MM-DD')
      WHERE "consultationBookingDate" IS NOT NULL
        AND ("consultationBookingKyivDay" IS NULL OR "consultationBookingKyivDay" = '');
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE "direct_clients"
      SET "paidServiceKyivDay" = to_char(timezone('Europe/Kyiv', "paidServiceDate"), 'YYYY-MM-DD')
      WHERE "paidServiceDate" IS NOT NULL
        AND ("paidServiceKyivDay" IS NULL OR "paidServiceKyivDay" = '');
    `);
    await prisma.$executeRawUnsafe(
      `UPDATE "direct_clients" SET "consultationBookingKyivDay" = NULL WHERE "consultationBookingDate" IS NULL;`
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "direct_clients" SET "paidServiceKyivDay" = NULL WHERE "paidServiceDate" IS NULL;`
    );
    directBookingKyivColumnsReady = true;
    console.log('[direct-booking-kyiv-ensure] колонки готові');
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/e4d350b7-7929-4c21-a27b-c6c6190d2dda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9597f' },
      body: JSON.stringify({
        sessionId: 'd9597f',
        location: 'direct-booking-kyiv-ensure.ts:success',
        message: 'ensureDirectBookingKyivDayColumns OK',
        data: { ready: true },
        timestamp: Date.now(),
        hypothesisId: 'H3',
      }),
    }).catch(() => {});
    // #endregion
  } catch (e) {
    console.warn('[direct-booking-kyiv-ensure] (не критично):', e);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/e4d350b7-7929-4c21-a27b-c6c6190d2dda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9597f' },
      body: JSON.stringify({
        sessionId: 'd9597f',
        location: 'direct-booking-kyiv-ensure.ts:catch',
        message: 'ensure failed',
        data: { err: (e as Error)?.message?.slice?.(0, 200) ?? String(e) },
        timestamp: Date.now(),
        hypothesisId: 'H3',
      }),
    }).catch(() => {});
    // #endregion
  }
}
