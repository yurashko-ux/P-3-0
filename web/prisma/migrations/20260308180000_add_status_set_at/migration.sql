-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "statusSetAt" TIMESTAMP(3);
