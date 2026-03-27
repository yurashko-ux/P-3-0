-- Денормалізовані календарні дні (Kyiv) для сортування списку без повного скану
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "consultationBookingKyivDay" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "paidServiceKyivDay" TEXT;

CREATE INDEX IF NOT EXISTS "direct_clients_consultationBookingKyivDay_idx" ON "direct_clients" ("consultationBookingKyivDay");
CREATE INDEX IF NOT EXISTS "direct_clients_paidServiceKyivDay_idx" ON "direct_clients" ("paidServiceKyivDay");

-- Бэкафіл з існуючих timestamptz (узгоджено з kyivDayFromISO у застосунку)
UPDATE "direct_clients"
SET "consultationBookingKyivDay" = to_char(timezone('Europe/Kyiv', "consultationBookingDate"), 'YYYY-MM-DD')
WHERE "consultationBookingDate" IS NOT NULL;

UPDATE "direct_clients"
SET "paidServiceKyivDay" = to_char(timezone('Europe/Kyiv', "paidServiceDate"), 'YYYY-MM-DD')
WHERE "paidServiceDate" IS NOT NULL;
