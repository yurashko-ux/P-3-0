-- Додаємо прапори скасування для консультації та платної послуги
-- Примітка: у продакшені в цьому проєкті використовується prisma db push,
-- але міграцію зберігаємо для історії змін, згідно правил репозиторію.

ALTER TABLE "direct_clients"
  ADD COLUMN IF NOT EXISTS "paidServiceCancelled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "consultationCancelled" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "direct_clients_paidServiceCancelled_idx"
  ON "direct_clients" ("paidServiceCancelled");

CREATE INDEX IF NOT EXISTS "direct_clients_consultationCancelled_idx"
  ON "direct_clients" ("consultationCancelled");

