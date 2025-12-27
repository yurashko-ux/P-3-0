// web/lib/prisma.ts
// Singleton Prisma Client для уникнення проблем з багатьма інстансами в development

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  try {
    // Для Vercel/Prisma Postgres використовуємо connection pooling
    const client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      // Додаємо налаштування для serverless
      // Для Prisma Postgres в Vercel використовується PRISMA_DATABASE_URL
      datasources: {
        db: {
          url: process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL,
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

