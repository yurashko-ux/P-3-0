-- Контрольний залишок завдатку з нічного знімка Altegio.
ALTER TABLE "client_deposit_accounts" ADD COLUMN IF NOT EXISTS "altegioBalance" DOUBLE PRECISION;
ALTER TABLE "client_deposit_accounts" ADD COLUMN IF NOT EXISTS "altegioBalanceAt" TIMESTAMP(3);
