-- Нагадування «передзвонити» в таблиці Direct
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderKyivDay" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderNote" TEXT;

CREATE INDEX IF NOT EXISTS "direct_clients_callbackReminderKyivDay_idx" ON "direct_clients"("callbackReminderKyivDay");
