-- Графік змін у Kresco. Наявні таблиці не змінюємо.
CREATE TABLE IF NOT EXISTS "team_work_days" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "altegioStaffId" INTEGER NOT NULL,
  "teamMemberId" TEXT,
  "kyivDay" TEXT NOT NULL,
  "slots" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_work_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "team_work_days_altegioStaffId_kyivDay_key" ON "team_work_days"("altegioStaffId", "kyivDay");
CREATE INDEX IF NOT EXISTS "team_work_days_kyivDay_idx" ON "team_work_days"("kyivDay");
CREATE INDEX IF NOT EXISTS "team_work_days_teamMemberId_idx" ON "team_work_days"("teamMemberId");

DO $$ BEGIN
  ALTER TABLE "team_work_days" ADD CONSTRAINT "team_work_days_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Власний id людини ставить той самий тригер, що й для записів журналу.
DROP TRIGGER IF EXISTS "team_work_days_fill_team_member" ON "team_work_days";
CREATE TRIGGER "team_work_days_fill_team_member"
  BEFORE INSERT OR UPDATE OF "altegioStaffId", "teamMemberId" ON "team_work_days"
  FOR EACH ROW EXECUTE FUNCTION kresco_fill_team_member_id();
