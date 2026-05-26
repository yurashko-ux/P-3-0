-- Коментар і ручна мітка результату для сторінки «Консультації» (статистика / Ліди)
ALTER TABLE "direct_clients"
ADD COLUMN IF NOT EXISTS "consultationListComment" TEXT,
ADD COLUMN IF NOT EXISTS "consultationListOutcomeOverride" TEXT;
