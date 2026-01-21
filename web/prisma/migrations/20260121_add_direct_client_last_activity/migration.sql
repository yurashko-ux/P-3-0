-- Add last activity markers for Direct clients
ALTER TABLE "direct_clients" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
ALTER TABLE "direct_clients" ADD COLUMN "lastActivityKeys" JSONB;

CREATE INDEX IF NOT EXISTS "direct_clients_lastActivityAt_idx" ON "direct_clients"("lastActivityAt");

