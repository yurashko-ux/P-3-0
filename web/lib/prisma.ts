// web/lib/prisma.ts
// Singleton Prisma Client для уникнення проблем з багатьма інстансами в development

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let prismaInstance: PrismaClient | null = null;

/** Як обрано URL для Prisma Client (для діагностики check-db-connection). */
export type PrismaResolveMode =
  | 'use_database_url'
  | 'accelerate_fallback'
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

/** Прямі кандидати з Vercel/Neon (часто доступні, коли db.prisma.io з serverless не відповідає). */
function getDirectPostgresCandidate(): string | undefined {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    undefined
  );
}

function pickResolvedUrl(): { url: string | undefined; mode: PrismaResolveMode } {
  const prismaUrl = process.env.PRISMA_DATABASE_URL;
  const directCandidate = getDirectPostgresCandidate();

  // Явно: усі запити через прямий URL (перевірте, що це та сама БД, що й міграції).
  if (process.env.USE_DATABASE_URL_FOR_PRISMA === '1' && directCandidate) {
    return { url: directCandidate, mode: 'use_database_url' };
  }

  // Accelerate → direct
  if (prismaUrl && /accelerate\.prisma-data\.net/.test(prismaUrl)) {
    return { url: directCandidate || prismaUrl, mode: 'accelerate_fallback' };
  }

  // Prisma Postgres (db.prisma.io) недоступний з Vercel, а в проєкті є інший postgresql host — типовий дубль змінних.
  // Вимкнути примусове використання PRISMA_DATABASE_URL: PRISMA_STRICT_DB_PRISMA_IO=1
  if (
    prismaUrl &&
    directCandidate &&
    prismaUrl !== directCandidate &&
    process.env.PRISMA_STRICT_DB_PRISMA_IO !== '1'
  ) {
    const pHost = parseUrlHost(prismaUrl);
    const dHost = parseUrlHost(directCandidate);
    if (pHost === 'db.prisma.io' && dHost && dHost !== 'db.prisma.io') {
      console.warn(
        '[prisma] PRISMA_DATABASE_URL → db.prisma.io, прямий URL інший хост — використовуємо DATABASE_URL/POSTGRES_* (див. PRISMA_STRICT_DB_PRISMA_IO=1).'
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

function createPrismaClient(): PrismaClient {
  try {
    // Для Vercel/Prisma Postgres використовуємо connection pooling
    const client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      // Додаємо налаштування для serverless
      // Для Prisma Postgres в Vercel використовується PRISMA_DATABASE_URL
      // Якщо PRISMA_DATABASE_URL не встановлено, використовуємо DATABASE_URL як fallback
      datasources: {
        db: {
          url: resolveDatabaseUrl(),
        },
      },
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

