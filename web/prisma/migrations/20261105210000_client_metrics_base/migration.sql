-- Відмова від Altegio: visits / spent / lastVisitAt рахуємо в Kresco як база + журнал.
-- Базу фіксує перший запуск recompute-client-metrics, міграція дані не змінює.

ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "metricsBaseVisits" INTEGER;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "metricsBaseSpent" INTEGER;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "metricsBaseLastVisitAt" TIMESTAMP(3);
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "metricsBaseAt" TIMESTAMP(3);
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "altegioVisits" INTEGER;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "altegioSpent" INTEGER;
