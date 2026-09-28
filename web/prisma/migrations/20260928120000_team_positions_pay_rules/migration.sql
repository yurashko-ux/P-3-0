-- Посади Команди + правила схем ЗП з історією (без автонарахування).

-- 1) Довідник посад
CREATE TABLE IF NOT EXISTS "team_positions" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_positions_code_key" ON "team_positions"("code");
CREATE INDEX IF NOT EXISTS "team_positions_isActive_idx" ON "team_positions"("isActive");
CREATE INDEX IF NOT EXISTS "team_positions_order_idx" ON "team_positions"("order");

-- Стартові посади (колишній salonRole)
INSERT INTO "team_positions" ("id", "name", "code", "isActive", "order", "createdAt", "updatedAt")
VALUES
  ('pos_master', 'Майстер', 'master', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pos_assistant', 'Асистент', 'assistant', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pos_admin', 'Адміністратор', 'admin', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pos_direct', 'Direct', 'direct', true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pos_other', 'Інше', 'other', true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 2) Версії правил посади
CREATE TABLE IF NOT EXISTS "team_position_pay_rule_versions" (
  "id" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "effectiveFrom" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  CONSTRAINT "team_position_pay_rule_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "team_position_pay_rule_versions_positionId_idx"
  ON "team_position_pay_rule_versions"("positionId");
CREATE INDEX IF NOT EXISTS "team_position_pay_rule_versions_positionId_effectiveFrom_idx"
  ON "team_position_pay_rule_versions"("positionId", "effectiveFrom");

ALTER TABLE "team_position_pay_rule_versions"
  DROP CONSTRAINT IF EXISTS "team_position_pay_rule_versions_positionId_fkey";
ALTER TABLE "team_position_pay_rule_versions"
  ADD CONSTRAINT "team_position_pay_rule_versions_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "team_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Схеми у версії правила
CREATE TABLE IF NOT EXISTS "team_position_pay_rule_schemes" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "schemeId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "team_position_pay_rule_schemes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_position_pay_rule_schemes_versionId_schemeId_key"
  ON "team_position_pay_rule_schemes"("versionId", "schemeId");
CREATE INDEX IF NOT EXISTS "team_position_pay_rule_schemes_schemeId_idx"
  ON "team_position_pay_rule_schemes"("schemeId");

ALTER TABLE "team_position_pay_rule_schemes"
  DROP CONSTRAINT IF EXISTS "team_position_pay_rule_schemes_versionId_fkey";
ALTER TABLE "team_position_pay_rule_schemes"
  ADD CONSTRAINT "team_position_pay_rule_schemes_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "team_position_pay_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_position_pay_rule_schemes"
  DROP CONSTRAINT IF EXISTS "team_position_pay_rule_schemes_schemeId_fkey";
ALTER TABLE "team_position_pay_rule_schemes"
  ADD CONSTRAINT "team_position_pay_rule_schemes_schemeId_fkey"
  FOREIGN KEY ("schemeId") REFERENCES "team_pay_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Історія призначень людині
CREATE TABLE IF NOT EXISTS "team_member_pay_assignments" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "positionId" TEXT,
  "ruleVersionId" TEXT,
  "effectiveFrom" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_member_pay_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "team_member_pay_assignments_memberId_idx"
  ON "team_member_pay_assignments"("memberId");
CREATE INDEX IF NOT EXISTS "team_member_pay_assignments_memberId_effectiveFrom_idx"
  ON "team_member_pay_assignments"("memberId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "team_member_pay_assignments_ruleVersionId_idx"
  ON "team_member_pay_assignments"("ruleVersionId");

ALTER TABLE "team_member_pay_assignments"
  DROP CONSTRAINT IF EXISTS "team_member_pay_assignments_memberId_fkey";
ALTER TABLE "team_member_pay_assignments"
  ADD CONSTRAINT "team_member_pay_assignments_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "team_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_member_pay_assignments"
  DROP CONSTRAINT IF EXISTS "team_member_pay_assignments_ruleVersionId_fkey";
ALTER TABLE "team_member_pay_assignments"
  ADD CONSTRAINT "team_member_pay_assignments_ruleVersionId_fkey"
  FOREIGN KEY ("ruleVersionId") REFERENCES "team_position_pay_rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "team_member_pay_assignment_schemes" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "schemeId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "team_member_pay_assignment_schemes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_member_pay_assignment_schemes_assignmentId_schemeId_key"
  ON "team_member_pay_assignment_schemes"("assignmentId", "schemeId");
CREATE INDEX IF NOT EXISTS "team_member_pay_assignment_schemes_schemeId_idx"
  ON "team_member_pay_assignment_schemes"("schemeId");

ALTER TABLE "team_member_pay_assignment_schemes"
  DROP CONSTRAINT IF EXISTS "team_member_pay_assignment_schemes_assignmentId_fkey";
ALTER TABLE "team_member_pay_assignment_schemes"
  ADD CONSTRAINT "team_member_pay_assignment_schemes_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "team_member_pay_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_member_pay_assignment_schemes"
  DROP CONSTRAINT IF EXISTS "team_member_pay_assignment_schemes_schemeId_fkey";
ALTER TABLE "team_member_pay_assignment_schemes"
  ADD CONSTRAINT "team_member_pay_assignment_schemes_schemeId_fkey"
  FOREIGN KEY ("schemeId") REFERENCES "team_pay_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) TeamMember.positionId + прибрати paySchemeId
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "positionId" TEXT;

UPDATE "team_members" m
SET "positionId" = p."id"
FROM "team_positions" p
WHERE m."positionId" IS NULL
  AND p."code" = m."salonRole";

UPDATE "team_members" m
SET "positionId" = 'pos_other'
WHERE m."positionId" IS NULL;

CREATE INDEX IF NOT EXISTS "team_members_positionId_idx" ON "team_members"("positionId");

ALTER TABLE "team_members"
  DROP CONSTRAINT IF EXISTS "team_members_positionId_fkey";
ALTER TABLE "team_members"
  ADD CONSTRAINT "team_members_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "team_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_paySchemeId_fkey";
DROP INDEX IF EXISTS "team_members_paySchemeId_idx";
ALTER TABLE "team_members" DROP COLUMN IF EXISTS "paySchemeId";
