-- Історія нагадувань «передзвонити»
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callbackReminderHistory" JSONB;
