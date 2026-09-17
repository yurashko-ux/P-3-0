-- Назви складів лише в Kresco: не перезаписувати з Altegio

ALTER TABLE "warehouse_storages"
  ADD COLUMN IF NOT EXISTS "titleLocked" BOOLEAN NOT NULL DEFAULT false;

UPDATE "warehouse_storages"
SET
  "title" = 'Витратні матеріали',
  "titleLocked" = true,
  "isActive" = true
WHERE "altegioStorageId" = 2343837;

UPDATE "warehouse_storages"
SET
  "title" = 'Товари',
  "titleLocked" = true,
  "isActive" = true
WHERE "altegioStorageId" = 2343838;
