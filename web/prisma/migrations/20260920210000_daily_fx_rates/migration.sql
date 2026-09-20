-- Денні курси валют (Monobank rateBuy → робочий = round(buy)+1), фіксація на день Europe/Kyiv.

CREATE TABLE IF NOT EXISTS "daily_fx_rates" (
  "id" TEXT NOT NULL,
  "kyivDay" TEXT NOT NULL,
  "usdBuy" DOUBLE PRECISION NOT NULL,
  "eurBuy" DOUBLE PRECISION NOT NULL,
  "usdWorking" DOUBLE PRECISION NOT NULL,
  "eurWorking" DOUBLE PRECISION NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'monobank',
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_fx_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_fx_rates_kyivDay_key" ON "daily_fx_rates"("kyivDay");
CREATE INDEX IF NOT EXISTS "daily_fx_rates_kyivDay_idx" ON "daily_fx_rates"("kyivDay");
