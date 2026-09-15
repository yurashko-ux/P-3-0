-- Етап 1 складу: групи каталогу, валюти, поля прийомки, dual-write в Altegio

CREATE TABLE IF NOT EXISTS "warehouse_product_groups" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "isHair" BOOLEAN NOT NULL DEFAULT false,
  "altegioCategoryId" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warehouse_product_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_product_groups_altegioCategoryId_key"
  ON "warehouse_product_groups" ("altegioCategoryId");
CREATE INDEX IF NOT EXISTS "warehouse_product_groups_title_idx"
  ON "warehouse_product_groups" ("title");

CREATE TABLE IF NOT EXISTS "system_currencies" (
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_currencies_pkey" PRIMARY KEY ("code")
);

INSERT INTO "system_currencies" ("code", "title", "enabled")
VALUES
  ('UAH', 'Українська гривня', true),
  ('USD', 'Долар США', true)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "warehouse_products"
  ADD COLUMN IF NOT EXISTS "groupId" TEXT,
  ADD COLUMN IF NOT EXISTS "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "warehouse_products_groupId_idx"
  ON "warehouse_products" ("groupId");

ALTER TABLE "warehouse_products"
  ADD CONSTRAINT "warehouse_products_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "warehouse_product_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "warehouse_documents"
  ADD COLUMN IF NOT EXISTS "kind" TEXT,
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "currencyCode" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "deliveryAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "invoiceWeightGrams" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "weightDeltaGrams" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "fxRateUsdUah" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "weightMismatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "syncStatus" TEXT NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS "syncError" TEXT,
  ADD COLUMN IF NOT EXISTS "parentDocumentId" TEXT;

CREATE INDEX IF NOT EXISTS "warehouse_documents_kind_idx"
  ON "warehouse_documents" ("kind");
CREATE INDEX IF NOT EXISTS "warehouse_documents_syncStatus_idx"
  ON "warehouse_documents" ("syncStatus");
CREATE INDEX IF NOT EXISTS "warehouse_documents_parentDocumentId_idx"
  ON "warehouse_documents" ("parentDocumentId");

ALTER TABLE "warehouse_documents"
  ADD CONSTRAINT "warehouse_documents_parentDocumentId_fkey"
  FOREIGN KEY ("parentDocumentId") REFERENCES "warehouse_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "warehouse_document_lines"
  ADD COLUMN IF NOT EXISTS "weightGrams" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "costUsd" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "costInDocumentCurrency" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "countedQty" DOUBLE PRECISION;
