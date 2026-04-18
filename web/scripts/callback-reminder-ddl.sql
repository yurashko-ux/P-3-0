-- Одноразово: колонки «передзвонити» для direct_clients (див. prisma/migrations/*callback*).
-- Виконання з каталогу web:
--   npx prisma db execute --file scripts/callback-reminder-ddl.sql --schema prisma/schema.prisma
-- У .env.local має бути PRISMA_DATABASE_URL (той самий рядок, що в Prisma / Vercel для CRM-P-3-0).

ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderKyivDay" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderNote" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderHistory" JSONB;
CREATE INDEX IF NOT EXISTS "direct_clients_callbackReminderKyivDay_idx" ON "direct_clients"("callbackReminderKyivDay");
