-- Канонічні послуги Kresco + мапінг Altegio (many-to-one).
-- Старі 1:1 рядки деактивуємо після переносу посилань і рядків записів.

-- 1) Таблиця мапінгу
CREATE TABLE IF NOT EXISTS "salon_service_altegio_links" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "altegioServiceId" INTEGER NOT NULL,
  "altegioTitle" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "salon_service_altegio_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salon_service_altegio_links_altegioServiceId_key"
  ON "salon_service_altegio_links" ("altegioServiceId");
CREATE INDEX IF NOT EXISTS "salon_service_altegio_links_serviceId_idx"
  ON "salon_service_altegio_links" ("serviceId");
CREATE INDEX IF NOT EXISTS "salon_service_altegio_links_isDefault_idx"
  ON "salon_service_altegio_links" ("isDefault");

-- 2) source на канонічній послузі
ALTER TABLE "salon_services" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'mapped';
CREATE INDEX IF NOT EXISTS "salon_services_source_idx" ON "salon_services" ("source");

-- 3) Знімаємо unique з altegioServiceId (колонку поки лишаємо для міграції даних)
DROP INDEX IF EXISTS "salon_services_altegioServiceId_key";

-- 4) Канонічні 9 послуг (фіксовані UUID)
INSERT INTO "salon_services" ("id", "title", "kind", "durationSec", "isActive", "source", "createdAt", "updatedAt", "altegioServiceId")
VALUES
  ('c0a10001-0001-4000-8000-000000000001', 'Консультація', 'consultation', 1800, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 11964320),
  ('c0a10001-0001-4000-8000-000000000002', 'Онлайн-консультація', 'consultation', 3600, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 13212080),
  ('c0a10001-0001-4000-8000-000000000003', 'Зняття чужого нарощування', 'hair', 9000, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 11940573),
  ('c0a10001-0001-4000-8000-000000000004', 'Капсульне (до 130 г)', 'hair', 18000, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 11928107),
  ('c0a10001-0001-4000-8000-000000000005', 'Капсульне (від 130 г)', 'hair', 18000, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 11940080),
  ('c0a10001-0001-4000-8000-000000000006', 'Капсульне — скронева зона', 'hair', 10800, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 11940099),
  ('c0a10001-0001-4000-8000-000000000007', 'Капсульне — загущення', 'hair', 10800, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 11940102),
  ('c0a10001-0001-4000-8000-000000000008', 'Нарощування на стрічки', 'hair', 3600, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 11967869),
  ('c0a10001-0001-4000-8000-000000000009', 'Стрічкове V_BIOTAPE', 'hair', 12600, true, 'mapped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 11974881)
ON CONFLICT ("id") DO NOTHING;

-- 5) Мапінг Altegio → канонічні (isDefault = «основний» варіант без 4 рук / 2 майстрів)
INSERT INTO "salon_service_altegio_links" ("id", "serviceId", "altegioServiceId", "altegioTitle", "isDefault", "createdAt", "updatedAt")
VALUES
  ('c0a1link-0001-4000-8000-000000000001', 'c0a10001-0001-4000-8000-000000000001', 11964320, 'Консультація', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-000000000002', 'c0a10001-0001-4000-8000-000000000002', 13212080, 'Онлайн-консультація', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-000000000003', 'c0a10001-0001-4000-8000-000000000003', 11940573, 'Зняття чужого нарощування', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-000000000004', 'c0a10001-0001-4000-8000-000000000003', 11940731, 'Зняття чужого нарощування в 4 руки', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-000000000005', 'c0a10001-0001-4000-8000-000000000004', 11928107, 'Капсульне нарощування 1 майстер (до 130грам)', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-000000000006', 'c0a10001-0001-4000-8000-000000000004', 11994206, 'Нарощування волосся 2 майстри (до 130 грам)', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-000000000007', 'c0a10001-0001-4000-8000-000000000005', 11940080, 'Капсульне нарощування 1 майстер (від 130)', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-000000000008', 'c0a10001-0001-4000-8000-000000000005', 11973822, 'Капсульне нарощування 2 майстри (від 130грам)', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-000000000009', 'c0a10001-0001-4000-8000-000000000005', 11940097, 'Капсульне нарощування в 4 руки (Асистент)', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-00000000000a', 'c0a10001-0001-4000-8000-000000000006', 11940099, 'Капсульне нарощування волосся - скронева зона', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-00000000000b', 'c0a10001-0001-4000-8000-000000000007', 11940102, 'Капсульне нарощування волосся загущення', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-00000000000c', 'c0a10001-0001-4000-8000-000000000008', 11967869, 'Нарощування на стрічки', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c0a1link-0001-4000-8000-00000000000d', 'c0a10001-0001-4000-8000-000000000009', 11974881, 'Стрічкове нарощування V_BIOTAPE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("altegioServiceId") DO NOTHING;

-- 6) Переносимо рядки записів зі старих 1:1 послуг на канонічні
UPDATE "salon_appointment_lines" AS l
SET "serviceId" = link."serviceId"
FROM "salon_services" AS old
JOIN "salon_service_altegio_links" AS link ON link."altegioServiceId" = old."altegioServiceId"
WHERE l."serviceId" = old.id
  AND old.id <> link."serviceId";

-- Також за altegioServiceId рядка, якщо serviceId був null
UPDATE "salon_appointment_lines" AS l
SET "serviceId" = link."serviceId"
FROM "salon_service_altegio_links" AS link
WHERE l."altegioServiceId" = link."altegioServiceId"
  AND (l."serviceId" IS NULL OR l."serviceId" NOT IN (
    SELECT id FROM "salon_services" WHERE "source" = 'mapped' AND "isActive" = true
      AND id LIKE 'c0a10001-%'
  ));

-- 7) Деактивуємо старі 1:1 імпорти (не канонічні UUID)
UPDATE "salon_services"
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE id NOT LIKE 'c0a10001-%'
  AND "source" = 'mapped';

-- 8) Прибираємо колонку altegioServiceId з канонічної таблиці
ALTER TABLE "salon_services" DROP COLUMN IF EXISTS "altegioServiceId";

-- 9) FK на мапінг
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_service_altegio_links_serviceId_fkey'
  ) THEN
    ALTER TABLE "salon_service_altegio_links"
      ADD CONSTRAINT "salon_service_altegio_links_serviceId_fkey"
      FOREIGN KEY ("serviceId") REFERENCES "salon_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
