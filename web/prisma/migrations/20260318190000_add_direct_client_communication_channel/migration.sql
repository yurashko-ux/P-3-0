-- Канал комунікації для колонки «Комунікація» у таблиці Direct
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "communicationChannel" TEXT;
