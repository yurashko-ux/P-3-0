-- Add lastVisitAt to direct_clients
ALTER TABLE "direct_clients" ADD COLUMN "lastVisitAt" TIMESTAMP(3);

-- Index for faster sorting/filtering (optional but helpful)
CREATE INDEX IF NOT EXISTS "direct_clients_lastVisitAt_idx" ON "direct_clients"("lastVisitAt");

