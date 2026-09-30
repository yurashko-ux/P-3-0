-- Hotfix: повернути team_members.paySchemeId після передчасної міграції
-- 20260928120000_team_positions_pay_rules (гілка посад ще не в main).
-- Старий прод-код очікує цю колонку для list/import людей.

ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "paySchemeId" TEXT;

CREATE INDEX IF NOT EXISTS "team_members_paySchemeId_idx" ON "team_members"("paySchemeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_paySchemeId_fkey'
  ) THEN
    ALTER TABLE "team_members"
      ADD CONSTRAINT "team_members_paySchemeId_fkey"
      FOREIGN KEY ("paySchemeId") REFERENCES "team_pay_schemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
