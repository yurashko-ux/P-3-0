-- Команда: схеми ЗП і картки людей салону

CREATE TABLE IF NOT EXISTS "team_pay_schemes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_pay_schemes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "team_pay_schemes_kind_idx" ON "team_pay_schemes"("kind");
CREATE INDEX IF NOT EXISTS "team_pay_schemes_isActive_idx" ON "team_pay_schemes"("isActive");

CREATE TABLE IF NOT EXISTS "team_members" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "salonRole" TEXT NOT NULL DEFAULT 'other',
    "altegioStaffId" INTEGER,
    "directMasterId" TEXT,
    "appUserId" TEXT,
    "paySchemeId" TEXT,
    "phone" TEXT,
    "telegramUsername" TEXT,
    "telegramChatId" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_members_altegioStaffId_key" ON "team_members"("altegioStaffId");
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_directMasterId_key" ON "team_members"("directMasterId");
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_appUserId_key" ON "team_members"("appUserId");
CREATE INDEX IF NOT EXISTS "team_members_salonRole_idx" ON "team_members"("salonRole");
CREATE INDEX IF NOT EXISTS "team_members_isActive_idx" ON "team_members"("isActive");
CREATE INDEX IF NOT EXISTS "team_members_order_idx" ON "team_members"("order");
CREATE INDEX IF NOT EXISTS "team_members_paySchemeId_idx" ON "team_members"("paySchemeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_directMasterId_fkey'
  ) THEN
    ALTER TABLE "team_members"
      ADD CONSTRAINT "team_members_directMasterId_fkey"
      FOREIGN KEY ("directMasterId") REFERENCES "direct_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_appUserId_fkey'
  ) THEN
    ALTER TABLE "team_members"
      ADD CONSTRAINT "team_members_appUserId_fkey"
      FOREIGN KEY ("appUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_paySchemeId_fkey'
  ) THEN
    ALTER TABLE "team_members"
      ADD CONSTRAINT "team_members_paySchemeId_fkey"
      FOREIGN KEY ("paySchemeId") REFERENCES "team_pay_schemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
