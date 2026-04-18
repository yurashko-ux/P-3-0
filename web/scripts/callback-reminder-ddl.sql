-- Одноразово: колонки «передзвонити» для direct_clients (див. prisma/migrations/*callback*).
-- Виконання: з каталогу web: npx prisma db execute --file scripts/callback-reminder-ddl.sql
-- Потрібен DATABASE_URL у .env.local на ту саму БД, що прод.

ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderKyivDay" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderNote" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderHistory" JSONB;
CREATE INDEX IF NOT EXISTS "direct_clients_callbackReminderKyivDay_idx" ON "direct_clients"("callbackReminderKyivDay");
