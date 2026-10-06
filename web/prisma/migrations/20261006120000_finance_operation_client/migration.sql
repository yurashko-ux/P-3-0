-- Хто платив: Instagram клієнта на момент збереження платежу.

ALTER TABLE "finance_operations" ADD COLUMN IF NOT EXISTS "clientInstagram" TEXT;
