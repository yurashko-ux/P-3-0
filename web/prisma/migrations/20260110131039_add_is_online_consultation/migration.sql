-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "isOnlineConsultation" BOOLEAN NOT NULL DEFAULT false;
