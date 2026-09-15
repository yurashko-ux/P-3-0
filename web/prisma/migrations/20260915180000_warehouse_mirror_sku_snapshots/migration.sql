-- Дзеркало складу: номер товару = id Altegio; знімки залишків по місяцях

ALTER TABLE "warehouse_products"
  ADD COLUMN IF NOT EXISTS "sku" INTEGER;

UPDATE "warehouse_products"
SET "sku" = "altegioGoodId"
WHERE "sku" IS NULL AND "altegioGoodId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_products_sku_key"
  ON "warehouse_products" ("sku");
CREATE INDEX IF NOT EXISTS "warehouse_products_sku_idx"
  ON "warehouse_products" ("sku");

CREATE TABLE IF NOT EXISTS "warehouse_stock_month_snapshots" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "productId" TEXT NOT NULL,
  "storageId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "valueUah" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warehouse_stock_month_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_stock_month_snapshots_year_month_productId_storageId_key"
  ON "warehouse_stock_month_snapshots" ("year", "month", "productId", "storageId");
CREATE INDEX IF NOT EXISTS "warehouse_stock_month_snapshots_year_month_idx"
  ON "warehouse_stock_month_snapshots" ("year", "month");
CREATE INDEX IF NOT EXISTS "warehouse_stock_month_snapshots_productId_idx"
  ON "warehouse_stock_month_snapshots" ("productId");

ALTER TABLE "warehouse_stock_month_snapshots"
  ADD CONSTRAINT "warehouse_stock_month_snapshots_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_stock_month_snapshots"
  ADD CONSTRAINT "warehouse_stock_month_snapshots_storageId_fkey"
  FOREIGN KEY ("storageId") REFERENCES "warehouse_storages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
