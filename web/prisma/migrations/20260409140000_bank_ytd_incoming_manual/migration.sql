-- Ручний YTD оборот (надходження) до дати + Monobank після неї
ALTER TABLE "bank_accounts"
ADD COLUMN IF NOT EXISTS "ytdIncomingManualKop" BIGINT,
ADD COLUMN IF NOT EXISTS "ytdIncomingManualThroughDate" TIMESTAMP(3);
