// web/lib/prisma.ts
// Singleton Prisma Client для уникнення проблем з багатьма інстансами в development

import { PrismaClient } from '@prisma/client';
import { kyivYmdFromDateTimeInput } from './direct-kyiv-today';
import { kyivDayColumnsExistCached } from './direct-kyiv-db-columns';

/** Оновлює денормалізовані *KyivDay при зміні дат букінгу (обхід шляхів без saveDirectClient). */
function patchDirectClientBookingKyivDays(data: Record<string, unknown> | undefined | null): void {
  if (!data || typeof data !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(data, 'consultationBookingDate')) {
    const v = data.consultationBookingDate;
    data.consultationBookingKyivDay =
      v == null ? null : kyivYmdFromDateTimeInput(v instanceof Date ? v : new Date(String(v)));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'paidServiceDate')) {
    const v = data.paidServiceDate;
    data.paidServiceKyivDay =
      v == null ? null : kyivYmdFromDateTimeInput(v instanceof Date ? v : new Date(String(v)));
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let prismaInstance: PrismaClient | null = null;

/** Один раз на процес: pickResolvedUrl викликається кілька разів за cold start */
const prismaGlobal = globalThis as unknown as { __loggedAccelerateTunnelChoice?: boolean };

/** Як обрано URL для Prisma Client (для діагностики check-db-connection). */
export type PrismaResolveMode =
  | 'use_database_url'
  /** Прямий URL (Neon тощо), коли є Accelerate у PRISMA_DATABASE_URL */
  | 'accelerate_fallback'
  /** Лише тунель Accelerate: прямий DATABASE_URL — db.prisma.io, прямий TCP з Vercel часто падає (P1001) */
  | 'accelerate_tunnel_only'
  | 'auto_direct_over_prisma_io'
  | 'prisma_primary'
  | 'database_only'
  | 'none';

function parseUrlHost(raw: string): string | null {
  try {
    return new URL(raw.replace(/^postgres(ql)?:/, 'postgresql:')).hostname || null;
  } catch {
    return null;
  }
}

/** Змінні оточення, де Vercel/Neon можуть покласти прямий postgresql:// (порядок = пріоритет перегляду). */
const DIRECT_POSTGRES_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING',
  'NEON_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  /** Інколи з’являється в інтеграціях Vercel Postgres */
  'VERCEL_POSTGRES_URL',
] as const;

/**
 * Кандидати з Vercel/Neon (часто кілька змінних; DATABASE_URL може дублювати db.prisma.io з PRISMA_DATABASE_URL).
 * Пріоритет: перший URL, чий хост не db.prisma.io — інакше перший у списку.
 */
function getDirectPostgresCandidate(): string | undefined {
  const candidates = DIRECT_POSTGRES_ENV_KEYS.map((k) => process.env[k]).filter(
    (u): u is string => typeof u === 'string' && u.trim().length > 0
  );

  if (!candidates.length) return undefined;

  const nonPrismaIo = candidates.find((u) => {
    const h = parseUrlHost(u);
    return h != null && h !== 'db.prisma.io';
  });
  return nonPrismaIo ?? candidates[0];
}

function pickResolvedUrl(): { url: string | undefined; mode: PrismaResolveMode } {
  const prismaUrl = process.env.PRISMA_DATABASE_URL;
  const directCandidate = getDirectPostgresCandidate();

  // Явно: усі запити через прямий URL (перевірте, що це та сама БД, що й міграції).
  if (process.env.USE_DATABASE_URL_FOR_PRISMA === '1' && directCandidate) {
    return { url: directCandidate, mode: 'use_database_url' };
  }

  // Accelerate: пріоритет прямого postgresql:// на Neon/інший хост; НЕ підставляти прямий db.prisma.io —
  // з Vercel TCP до db.prisma.io часто недоступний; тоді лишаємо тунель Accelerate (prismaUrl).
  if (prismaUrl && /accelerate\.prisma-data\.net/.test(prismaUrl)) {
    const dHost = directCandidate ? parseUrlHost(directCandidate) : null;
    if (directCandidate && dHost && dHost !== 'db.prisma.io') {
      return { url: directCandidate, mode: 'accelerate_fallback' };
    }
    if (process.env.VERCEL === '1' && directCandidate && dHost === 'db.prisma.io') {
      if (!prismaGlobal.__loggedAccelerateTunnelChoice) {
        prismaGlobal.__loggedAccelerateTunnelChoice = true;
        console.warn(
          '[prisma] Accelerate: DATABASE_URL/POSTGRES_* ведуть на db.prisma.io — прямий TCP з Vercel ненадійний; використовуємо PRISMA_DATABASE_URL (Accelerate). Додайте NEON_DATABASE_URL для прямого доступу без тунелю.'
        );
      }
    }
    return { url: prismaUrl, mode: 'accelerate_tunnel_only' };
  }

  // Prisma Postgres (db.prisma.io) з Vercel часто флапає; якщо є кандидат з іншим хостом — перемикаємось.
  // Умова prismaUrl !== directCandidate прибирала bypass, коли рядки збігалися за змістом (рідко, але не потрібна).
  // Вимкнути примус Prisma IO: PRISMA_STRICT_DB_PRISMA_IO=1
  if (prismaUrl && directCandidate && process.env.PRISMA_STRICT_DB_PRISMA_IO !== '1') {
    const pHost = parseUrlHost(prismaUrl);
    const dHost = parseUrlHost(directCandidate);
    if (pHost === 'db.prisma.io' && dHost != null && dHost !== 'db.prisma.io') {
      console.warn(
        '[prisma] PRISMA_DATABASE_URL → db.prisma.io, прямий URL інший хост — використовуємо DIRECT_POSTGRES_* (див. PRISMA_STRICT_DB_PRISMA_IO=1).'
      );
      return { url: directCandidate, mode: 'auto_direct_over_prisma_io' };
    }
  }

  if (prismaUrl) return { url: prismaUrl, mode: 'prisma_primary' };
  if (directCandidate) return { url: directCandidate, mode: 'database_only' };
  return { url: undefined, mode: 'none' };
}

export function getPrismaResolveMode(): PrismaResolveMode {
  return pickResolvedUrl().mode;
}

function resolveDatabaseUrl(): string | undefined {
  return pickResolvedUrl().url;
}

/** Лише hostname по кожній змінній — для Vercel Logs без секретів. */
function logPostgresEnvHostsDiagnostic(): void {
  if (process.env.VERCEL !== '1') return;
  const bits: string[] = [];
  const pu = process.env.PRISMA_DATABASE_URL;
  bits.push(`PRISMA_DATABASE_URL:${pu ? parseUrlHost(pu) ?? '?' : '—'}`);
  for (const k of DIRECT_POSTGRES_ENV_KEYS) {
    const v = process.env[k];
    bits.push(`${k}:${v ? parseUrlHost(v) ?? '?' : '—'}`);
  }
  console.warn('[prisma] хости змінних (без секретів):', bits.join(' | '));
}

function createPrismaClient(): PrismaClient {
  try {
    const resolvedUrl = resolveDatabaseUrl();
    if (process.env.VERCEL === '1' && resolvedUrl && parseUrlHost(resolvedUrl) === 'db.prisma.io') {
      logPostgresEnvHostsDiagnostic();
      const hasAltHost = DIRECT_POSTGRES_ENV_KEYS.some((k) => {
        const v = process.env[k];
        const h = v ? parseUrlHost(v) : null;
        return h != null && h !== 'db.prisma.io';
      });
      console.warn(
        hasAltHost
          ? '[prisma] Runtime лишається на db.prisma.io (напр. PRISMA_STRICT_DB_PRISMA_IO=1); при P1001 приберіть strict або виправте змінні.'
          : '[prisma] Усі відомі URL вказують на db.prisma.io або порожні — додайте Neon: POSTGRES_URL / NEON_DATABASE_URL у Vercel.'
      );
    }
    // Для Vercel/Prisma Postgres використовуємо connection pooling
    const client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      // Додаємо налаштування для serverless
      // Для Prisma Postgres в Vercel використовується PRISMA_DATABASE_URL
      // Якщо PRISMA_DATABASE_URL не встановлено, використовуємо DATABASE_URL як fallback
      datasources: {
        db: {
          url: resolvedUrl,
        },
      },
    });

    client.$use(async (params, next) => {
      if (params.model === 'DirectClient') {
        const kyivOk = await kyivDayColumnsExistCached(client);
        // Не інжектимо `omit`: у prisma-client-js 5.22 без preview omit API аргумент невідомий
        // (PrismaClientValidationError: Unknown argument `omit`). Поки колонок *KyivDay немає в БД —
        // обхід через raw SQL / явний select / migrate deploy (див. direct-store getAllDirectClientsOnce).
        if (kyivOk) {
          if (params.action === 'create' || params.action === 'update') {
            patchDirectClientBookingKyivDays(params.args.data as Record<string, unknown>);
          }
          if (params.action === 'upsert') {
            const a = params.args as { create?: Record<string, unknown>; update?: Record<string, unknown> };
            patchDirectClientBookingKyivDays(a.create);
            patchDirectClientBookingKyivDays(a.update);
          }
          if (params.action === 'updateMany' && (params.args as { data?: Record<string, unknown> }).data) {
            patchDirectClientBookingKyivDays((params.args as { data: Record<string, unknown> }).data);
          }
          if (params.action === 'createMany') {
            const rows = (params.args as { data?: unknown[] }).data;
            if (Array.isArray(rows)) {
              for (const row of rows) {
                patchDirectClientBookingKyivDays(row as Record<string, unknown>);
              }
            }
          }
        }
      }
      return next(params);
    });

    // НЕ викликаємо $connect() при створенні - Prisma підключається автоматично при першому запиті
    // Це важливо для serverless функцій, щоб уникнути проблем з cold start

    return client;
  } catch (err) {
    console.error('[prisma] Failed to create Prisma Client:', err);
    throw err;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  (prismaInstance ??= createPrismaClient());

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** Повертає маскований рядок для логу (хост БД без пароля) — для діагностики "2 бази". */
export function getDbHostForLog(): string {
  const url = resolveDatabaseUrl() || "";
  if (!url) return "no-url";
  try {
    const u = new URL(url.replace(/^postgres:/, "postgresql:"));
    const port = u.port && u.port !== "5432" ? `:${u.port}` : "";
    const db = (u.pathname || "").replace(/^\//, "") || "default";
    return `${u.hostname}${port}/${db}`;
  } catch {
    return "parse-error";
  }
}

// Діагностика Vercel: який хост реально обрано (без секретів)
if (process.env.VERCEL === '1') {
  try {
    console.log('[prisma] datasource', { mode: getPrismaResolveMode(), host: getDbHostForLog() });
  } catch {
    /* ignore */
  }
}

// Додаємо обробку помилок підключення при першому використанні
let connectionChecked = false;
export async function ensureConnection() {
  if (connectionChecked) return;
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    connectionChecked = true;
  } catch (err) {
    console.error('[prisma] Connection check failed:', err);
    connectionChecked = false;
    throw err;
  }
}

