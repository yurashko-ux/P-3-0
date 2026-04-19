-- KPI «нові ліди»: виключення Binotel та майбутніх імпортів (поле керується з коду)
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "includeInNewLeadsKpi" BOOLEAN NOT NULL DEFAULT true;

-- Історичні записи Binotel не повинні роздувати маркетингову метрику
UPDATE "direct_clients"
SET "includeInNewLeadsKpi" = false
WHERE "state" = 'binotel-lead'
   OR "instagramUsername" ~ '^binotel_';
