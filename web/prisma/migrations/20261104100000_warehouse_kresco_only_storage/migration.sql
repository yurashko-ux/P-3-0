-- Склад лише в Kresco (напр. «Волосся»): куди писати операції в Altegio + групи, що облікуються на ньому.
ALTER TABLE "warehouse_storages" ADD COLUMN IF NOT EXISTS "altegioWriteStorageId" INTEGER;
ALTER TABLE "warehouse_product_groups" ADD COLUMN IF NOT EXISTS "storageId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_product_groups_storageId_fkey'
  ) THEN
    ALTER TABLE "warehouse_product_groups"
      ADD CONSTRAINT "warehouse_product_groups_storageId_fkey"
      FOREIGN KEY ("storageId") REFERENCES "warehouse_storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
