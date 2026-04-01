ALTER TABLE "bank_statement_items"
ADD COLUMN IF NOT EXISTS "altegioBalanceSnapshot" BIGINT,
ADD COLUMN IF NOT EXISTS "altegioAccountTitleSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS "altegioSyncErrorSnapshot" TEXT,
ADD COLUMN IF NOT EXISTS "altegioBalanceCapturedAt" TIMESTAMP(3);
