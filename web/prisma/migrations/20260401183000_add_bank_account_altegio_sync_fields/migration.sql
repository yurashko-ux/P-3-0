ALTER TABLE "bank_accounts"
ADD COLUMN IF NOT EXISTS "altegioAccountId" TEXT,
ADD COLUMN IF NOT EXISTS "altegioAccountTitle" TEXT,
ADD COLUMN IF NOT EXISTS "altegioBalance" BIGINT,
ADD COLUMN IF NOT EXISTS "altegioBalanceUpdatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "altegioSyncError" TEXT;

CREATE INDEX IF NOT EXISTS "bank_accounts_altegioAccountId_idx"
  ON "bank_accounts" ("altegioAccountId");
