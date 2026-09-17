-- Знімок імені/телефону клієнта з Altegio для календаря журналу

ALTER TABLE "salon_appointments" ADD COLUMN IF NOT EXISTS "clientName" TEXT;
ALTER TABLE "salon_appointments" ADD COLUMN IF NOT EXISTS "clientPhone" TEXT;
