-- Приховування звільнених: картка лишається, зі списків CRM зникає.
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "hiddenByUserId" TEXT;
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "hiddenByName" TEXT;

CREATE INDEX IF NOT EXISTS "team_members_hiddenAt_idx" ON "team_members"("hiddenAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_hiddenByUserId_fkey'
  ) THEN
    ALTER TABLE "team_members"
      ADD CONSTRAINT "team_members_hiddenByUserId_fkey"
      FOREIGN KEY ("hiddenByUserId") REFERENCES "app_users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
