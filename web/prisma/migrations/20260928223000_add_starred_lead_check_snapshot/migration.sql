-- Знімок суми платного запису ліда зі зірочкою для колонки «Загальний чек»
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "starredLeadCheckUah" INTEGER;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "starredLeadCheckKyivDay" TEXT;
CREATE INDEX IF NOT EXISTS "direct_clients_starredLeadCheckKyivDay_idx" ON "direct_clients"("starredLeadCheckKyivDay");
