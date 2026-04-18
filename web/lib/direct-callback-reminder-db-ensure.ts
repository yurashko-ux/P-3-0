/**
 * Колонки «передзвонити» мають бути в БД, інакше Prisma findUnique/update з повною моделлю падає з P2022.
 * Якщо міграції ще не накатані — додаємо колонки через ALTER IF NOT EXISTS (потрібні права на DDL).
 */
import { prisma } from './prisma';
import {
  getDirectClientsTableColumnNames,
  invalidateDirectClientsTableColumnCache,
} from './direct-client-raw-insert';

const LOG = '[direct-callback-reminder-db-ensure]';

export type EnsureCallbackReminderColumnsResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export async function ensureDirectCallbackReminderColumnsExist(): Promise<EnsureCallbackReminderColumnsResult> {
  try {
    const cols = await getDirectClientsTableColumnNames(prisma);
    const need =
      !cols.has('callbackReminderKyivDay') ||
      !cols.has('callbackReminderNote') ||
      !cols.has('callbackReminderHistory');

    if (!need) {
      return { ok: true };
    }

    console.log(`${LOG} Відсутні колонки нагадувань — виконуємо ALTER ADD IF NOT EXISTS`);

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderKyivDay" TEXT`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderNote" TEXT`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderHistory" JSONB`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "direct_clients_callbackReminderKyivDay_idx" ON "direct_clients"("callbackReminderKyivDay")`
    );

    invalidateDirectClientsTableColumnCache();
    return { ok: true };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    const msg = e?.message || String(err);
    console.error(`${LOG} Не вдалося додати колонки нагадувань:`, err);
    return {
      ok: false,
      error: msg,
      code: e?.code,
    };
  }
}
