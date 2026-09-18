-- Каса: товари в чеку + привʼязка документа списання складу

ALTER TABLE "salon_checkouts" ADD COLUMN IF NOT EXISTS "totalGoods" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "salon_checkouts" ADD COLUMN IF NOT EXISTS "warehouseDocumentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "salon_checkouts_warehouseDocumentId_key" ON "salon_checkouts"("warehouseDocumentId");

CREATE TABLE IF NOT EXISTS "salon_checkout_good_lines" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "altegioGoodId" INTEGER,

    CONSTRAINT "salon_checkout_good_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "salon_checkout_good_lines_checkoutId_idx" ON "salon_checkout_good_lines"("checkoutId");
CREATE INDEX IF NOT EXISTS "salon_checkout_good_lines_productId_idx" ON "salon_checkout_good_lines"("productId");
CREATE INDEX IF NOT EXISTS "salon_checkout_good_lines_storageId_idx" ON "salon_checkout_good_lines"("storageId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_checkouts_warehouseDocumentId_fkey'
  ) THEN
    ALTER TABLE "salon_checkouts"
      ADD CONSTRAINT "salon_checkouts_warehouseDocumentId_fkey"
      FOREIGN KEY ("warehouseDocumentId") REFERENCES "warehouse_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_checkout_good_lines_checkoutId_fkey'
  ) THEN
    ALTER TABLE "salon_checkout_good_lines"
      ADD CONSTRAINT "salon_checkout_good_lines_checkoutId_fkey"
      FOREIGN KEY ("checkoutId") REFERENCES "salon_checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_checkout_good_lines_productId_fkey'
  ) THEN
    ALTER TABLE "salon_checkout_good_lines"
      ADD CONSTRAINT "salon_checkout_good_lines_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_checkout_good_lines_storageId_fkey'
  ) THEN
    ALTER TABLE "salon_checkout_good_lines"
      ADD CONSTRAINT "salon_checkout_good_lines_storageId_fkey"
      FOREIGN KEY ("storageId") REFERENCES "warehouse_storages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
