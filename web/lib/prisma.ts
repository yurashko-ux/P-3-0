// web/lib/prisma.ts
// Singleton Prisma Client для уникнення проблем з багатьма інстансами в development

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  try {
    return new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
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
