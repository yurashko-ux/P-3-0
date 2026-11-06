-- Етап відмови від Altegio: власний id майстра (TeamMember) замість altegioStaffId у зв'язках.
-- Старі колонки altegioStaffId лишаються (імпорт з Altegio і fallback).
-- Тригери заповнюють teamMemberId з altegioStaffId, тож код запису журналу міняти не треба.

ALTER TABLE "salon_appointments" ADD COLUMN IF NOT EXISTS "teamMemberId" TEXT;
ALTER TABLE "salon_appointment_participants" ADD COLUMN IF NOT EXISTS "teamMemberId" TEXT;
ALTER TABLE "finance_operation_lines" ADD COLUMN IF NOT EXISTS "teamMemberId" TEXT;

CREATE INDEX IF NOT EXISTS "salon_appointments_teamMemberId_idx" ON "salon_appointments"("teamMemberId");
CREATE INDEX IF NOT EXISTS "salon_appointment_participants_teamMemberId_idx" ON "salon_appointment_participants"("teamMemberId");
CREATE INDEX IF NOT EXISTS "finance_operation_lines_teamMemberId_idx" ON "finance_operation_lines"("teamMemberId");

DO $$ BEGIN
  ALTER TABLE "salon_appointments" ADD CONSTRAINT "salon_appointments_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "salon_appointment_participants" ADD CONSTRAINT "salon_appointment_participants_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "finance_operation_lines" ADD CONSTRAINT "finance_operation_lines_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Заповнення наявних рядків
UPDATE "salon_appointments" a SET "teamMemberId" = t."id"
  FROM "team_members" t
  WHERE a."teamMemberId" IS NULL AND a."altegioStaffId" IS NOT NULL AND t."altegioStaffId" = a."altegioStaffId";
UPDATE "salon_appointment_participants" p SET "teamMemberId" = t."id"
  FROM "team_members" t
  WHERE p."teamMemberId" IS NULL AND p."altegioStaffId" > 0 AND t."altegioStaffId" = p."altegioStaffId";
UPDATE "finance_operation_lines" l SET "teamMemberId" = t."id"
  FROM "team_members" t
  WHERE l."teamMemberId" IS NULL AND l."altegioStaffId" IS NOT NULL AND t."altegioStaffId" = l."altegioStaffId";

-- Новий рядок / зміна altegioStaffId → підставити TeamMember.
-- Якщо код явно задав teamMemberId і altegioStaffId не змінювався — не чіпаємо.
CREATE OR REPLACE FUNCTION kresco_fill_team_member_id() RETURNS trigger AS $$
BEGIN
  IF NEW."altegioStaffId" IS NULL OR NEW."altegioStaffId" <= 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."teamMemberId" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW."altegioStaffId" IS NOT DISTINCT FROM OLD."altegioStaffId"
     AND NEW."teamMemberId" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT t."id" INTO NEW."teamMemberId" FROM "team_members" t WHERE t."altegioStaffId" = NEW."altegioStaffId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "salon_appointments_fill_team_member" ON "salon_appointments";
CREATE TRIGGER "salon_appointments_fill_team_member"
  BEFORE INSERT OR UPDATE OF "altegioStaffId", "teamMemberId" ON "salon_appointments"
  FOR EACH ROW EXECUTE FUNCTION kresco_fill_team_member_id();

DROP TRIGGER IF EXISTS "salon_appointment_participants_fill_team_member" ON "salon_appointment_participants";
CREATE TRIGGER "salon_appointment_participants_fill_team_member"
  BEFORE INSERT OR UPDATE OF "altegioStaffId", "teamMemberId" ON "salon_appointment_participants"
  FOR EACH ROW EXECUTE FUNCTION kresco_fill_team_member_id();

DROP TRIGGER IF EXISTS "finance_operation_lines_fill_team_member" ON "finance_operation_lines";
CREATE TRIGGER "finance_operation_lines_fill_team_member"
  BEFORE INSERT OR UPDATE OF "altegioStaffId", "teamMemberId" ON "finance_operation_lines"
  FOR EACH ROW EXECUTE FUNCTION kresco_fill_team_member_id();

-- Картці людини призначили або змінили altegioStaffId → дотягнути її рядки.
CREATE OR REPLACE FUNCTION kresco_team_member_staff_changed() RETURNS trigger AS $$
BEGIN
  IF NEW."altegioStaffId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."altegioStaffId" IS NOT DISTINCT FROM OLD."altegioStaffId" THEN
    RETURN NEW;
  END IF;
  UPDATE "salon_appointments" SET "teamMemberId" = NEW."id"
    WHERE "altegioStaffId" = NEW."altegioStaffId" AND "teamMemberId" IS DISTINCT FROM NEW."id";
  UPDATE "salon_appointment_participants" SET "teamMemberId" = NEW."id"
    WHERE "altegioStaffId" = NEW."altegioStaffId" AND "teamMemberId" IS DISTINCT FROM NEW."id";
  UPDATE "finance_operation_lines" SET "teamMemberId" = NEW."id"
    WHERE "altegioStaffId" = NEW."altegioStaffId" AND "teamMemberId" IS DISTINCT FROM NEW."id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "team_members_staff_changed" ON "team_members";
CREATE TRIGGER "team_members_staff_changed"
  AFTER INSERT OR UPDATE OF "altegioStaffId" ON "team_members"
  FOR EACH ROW EXECUTE FUNCTION kresco_team_member_staff_changed();
