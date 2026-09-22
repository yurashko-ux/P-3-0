-- Повна ціна послуги Kresco (UAH). Джерело істини — ручне редагування в каталозі.
ALTER TABLE "salon_services" ADD COLUMN IF NOT EXISTS "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
