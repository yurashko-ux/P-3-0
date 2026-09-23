-- Історія виходу в неактивну базу / відновлення майбутнім записом.

CREATE TABLE IF NOT EXISTS "direct_inactive_lifecycle_events" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "kyivDay" TEXT NOT NULL,
  "source" TEXT,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_inactive_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "direct_inactive_lifecycle_events_clientId_type_kyivDay_key"
  ON "direct_inactive_lifecycle_events"("clientId", "type", "kyivDay");
CREATE INDEX IF NOT EXISTS "direct_inactive_lifecycle_events_clientId_idx"
  ON "direct_inactive_lifecycle_events"("clientId");
CREATE INDEX IF NOT EXISTS "direct_inactive_lifecycle_events_type_idx"
  ON "direct_inactive_lifecycle_events"("type");
CREATE INDEX IF NOT EXISTS "direct_inactive_lifecycle_events_kyivDay_idx"
  ON "direct_inactive_lifecycle_events"("kyivDay");
CREATE INDEX IF NOT EXISTS "direct_inactive_lifecycle_events_createdAt_idx"
  ON "direct_inactive_lifecycle_events"("createdAt");

DO $$ BEGIN
  ALTER TABLE "direct_inactive_lifecycle_events"
    ADD CONSTRAINT "direct_inactive_lifecycle_events_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "direct_clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
