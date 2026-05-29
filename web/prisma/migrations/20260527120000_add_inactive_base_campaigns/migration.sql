-- Неактивна база: telegramChatId на клієнтах + кампанії розсилки
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "telegramChatId" BIGINT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "telegramUserId" BIGINT;
CREATE INDEX IF NOT EXISTS "direct_clients_telegramChatId_idx" ON "direct_clients"("telegramChatId");

CREATE TABLE IF NOT EXISTS "inactive_base_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "channels" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inactive_base_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inactive_base_campaigns_createdAt_idx" ON "inactive_base_campaigns"("createdAt");

CREATE TABLE IF NOT EXISTS "inactive_base_campaign_runs" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "inactive_base_campaign_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inactive_base_campaign_runs_campaignId_idx" ON "inactive_base_campaign_runs"("campaignId");
CREATE INDEX IF NOT EXISTS "inactive_base_campaign_runs_startedAt_idx" ON "inactive_base_campaign_runs"("startedAt");
CREATE INDEX IF NOT EXISTS "inactive_base_campaign_runs_channel_idx" ON "inactive_base_campaign_runs"("channel");
ALTER TABLE "inactive_base_campaign_runs" DROP CONSTRAINT IF EXISTS "inactive_base_campaign_runs_campaignId_fkey";
ALTER TABLE "inactive_base_campaign_runs" ADD CONSTRAINT "inactive_base_campaign_runs_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "inactive_base_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "inactive_base_campaign_deliveries" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "personalizedBody" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inactive_base_campaign_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inactive_base_campaign_deliveries_runId_idx" ON "inactive_base_campaign_deliveries"("runId");
CREATE INDEX IF NOT EXISTS "inactive_base_campaign_deliveries_clientId_idx" ON "inactive_base_campaign_deliveries"("clientId");
CREATE INDEX IF NOT EXISTS "inactive_base_campaign_deliveries_status_idx" ON "inactive_base_campaign_deliveries"("status");
ALTER TABLE "inactive_base_campaign_deliveries" DROP CONSTRAINT IF EXISTS "inactive_base_campaign_deliveries_runId_fkey";
ALTER TABLE "inactive_base_campaign_deliveries" ADD CONSTRAINT "inactive_base_campaign_deliveries_runId_fkey" FOREIGN KEY ("runId") REFERENCES "inactive_base_campaign_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inactive_base_campaign_deliveries" DROP CONSTRAINT IF EXISTS "inactive_base_campaign_deliveries_clientId_fkey";
ALTER TABLE "inactive_base_campaign_deliveries" ADD CONSTRAINT "inactive_base_campaign_deliveries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "direct_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
