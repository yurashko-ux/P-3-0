-- Додаємо поля для "Майстер" (Altegio staff) та історії змін
-- Примітка: у продакшені в цьому проєкті часто використовується prisma db push,
-- але міграцію зберігаємо для історії змін, згідно правил репозиторію.

ALTER TABLE "direct_clients"
  ADD COLUMN IF NOT EXISTS "serviceMasterAltegioStaffId" INTEGER,
  ADD COLUMN IF NOT EXISTS "serviceMasterName" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceMasterHistory" TEXT;

CREATE INDEX IF NOT EXISTS "direct_clients_serviceMasterAltegioStaffId_idx"
  ON "direct_clients" ("serviceMasterAltegioStaffId");

CREATE INDEX IF NOT EXISTS "direct_clients_serviceMasterName_idx"
  ON "direct_clients" ("serviceMasterName");

