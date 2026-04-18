/**
 * Колонки «передзвонити» мають бути в БД, інакше Prisma findUnique/update з повною моделлю падає з P2022.
 * Пулер Neon часто відхиляє DDL — після основного з’єднання пробуємо прямий postgresql:// (unpooled).
 */
import { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import {
  getDirectClientsTableColumnNames,
  invalidateDirectClientsTableColumnCache,
} from './direct-client-raw-insert';

const LOG = '[direct-callback-reminder-db-ensure]';

/** SQL для Neon Console / psql, якщо runtime DDL недоступний */
export const CALLBACK_REMINDER_MANUAL_DDL_SQL = `-- Передзвонити (direct_clients)
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderKyivDay" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderNote" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderHistory" JSONB;
CREATE INDEX IF NOT EXISTS "direct_clients_callbackReminderKyivDay_idx" ON "direct_clients"("callbackReminderKyivDay");
`;

const DDL_STATEMENTS = [
  `ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderKyivDay" TEXT`,
  `ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderNote" TEXT`,
  `ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderHistory" JSONB`,
  `CREATE INDEX IF NOT EXISTS "direct_clients_callbackReminderKyivDay_idx" ON "direct_clients"("callbackReminderKyivDay")`,
] as const;

export type EnsureCallbackReminderColumnsResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

/** Кандидати прямого Postgres (той самий порядок пріоритету, що в prisma.ts для direct). */
function collectUnpooledPostgresUrlsForDdl(): { url: string; label: string }[] {
  const keys = [
    'DATABASE_URL_UNPOOLED',
    'POSTGRES_URL_NON_POOLING',
    'NEON_DATABASE_URL',
    'POSTGRES_PRISMA_URL',
    'VERCEL_POSTGRES_URL',
  ] as const;
  const out: { url: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const label of keys) {
    const u = process.env[label];
    if (typeof u !== 'string' || !u.trim().startsWith('postgres')) continue;
    const url = u.trim();
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label });
  }
  return out;
}

async function runDdlWithClient(client: PrismaClient): Promise<void> {
  for (const sql of DDL_STATEMENTS) {
    await client.$executeRawUnsafe(sql);
  }
}

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

    const primaryUrl = process.env.PRISMA_DATABASE_URL?.trim();
    let firstErr: unknown;

    try {
      await runDdlWithClient(prisma);
      invalidateDirectClientsTableColumnCache();
      return { ok: true };
    } catch (e) {
      firstErr = e;
      console.warn(`${LOG} DDL через основний Prisma-клієнт не вдався (часто пулер), пробуємо пряме з’єднання:`, e);
    }

    const candidates = collectUnpooledPostgresUrlsForDdl();
    for (const { url, label } of candidates) {
      if (primaryUrl && url === primaryUrl) {
        continue;
      }
      const c = new PrismaClient({ datasources: { db: { url } } });
      try {
        await runDdlWithClient(c);
        console.log(`${LOG} Колонки додано через ${label}`);
        invalidateDirectClientsTableColumnCache();
        return { ok: true };
      } catch (e) {
        console.warn(`${LOG} DDL через ${label} не вдалась:`, e);
        firstErr = firstErr ?? e;
      } finally {
        await c.$disconnect().catch(() => undefined);
      }
    }

    const e = firstErr as { code?: string; message?: string };
    const msg = e?.message || String(firstErr);
    console.error(`${LOG} Усі спроби DDL вичерпано:`, firstErr);
    return {
      ok: false,
      error: msg,
      code: e?.code,
    };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    const msg = e?.message || String(err);
    console.error(`${LOG} Не вдалося перевірити/додати колонки нагадувань:`, err);
    return {
      ok: false,
      error: msg,
      code: e?.code,
    };
  }
}
