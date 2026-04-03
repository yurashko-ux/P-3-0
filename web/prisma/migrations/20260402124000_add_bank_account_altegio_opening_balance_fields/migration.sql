ALTER TABLE "bank_accounts"
ADD COLUMN IF NOT EXISTS "altegioOpeningBalanceManual" BIGINT,
ADD COLUMN IF NOT EXISTS "altegioOpeningBalanceDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "altegioOpeningBalanceUpdatedAt" TIMESTAMP(3);
