-- Нативний склад Kresco: склади, товари, залишки, документи руху

CREATE TABLE IF NOT EXISTS "warehouse_storages" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "altegioStorageId" INTEGER,
  "includeInFinanceReport" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warehouse_storages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_storages_altegioStorageId_key"
  ON "warehouse_storages" ("altegioStorageId");
CREATE INDEX IF NOT EXISTS "warehouse_storages_title_idx" ON "warehouse_storages" ("title");

CREATE TABLE IF NOT EXISTS "warehouse_products" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'шт',
  "costPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isHair" BOOLEAN NOT NULL DEFAULT false,
  "lengthCm" INTEGER,
  "color" TEXT,
  "weightGrams" DOUBLE PRECISION,
  "altegioGoodId" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warehouse_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_products_altegioGoodId_key"
  ON "warehouse_products" ("altegioGoodId");
CREATE INDEX IF NOT EXISTS "warehouse_products_isHair_idx" ON "warehouse_products" ("isHair");
CREATE INDEX IF NOT EXISTS "warehouse_products_title_idx" ON "warehouse_products" ("title");
CREATE INDEX IF NOT EXISTS "warehouse_products_category_idx" ON "warehouse_products" ("category");

CREATE TABLE IF NOT EXISTS "warehouse_stocks" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "storageId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warehouse_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_stocks_productId_storageId_key"
  ON "warehouse_stocks" ("productId", "storageId");
CREATE INDEX IF NOT EXISTS "warehouse_stocks_storageId_idx" ON "warehouse_stocks" ("storageId");
CREATE INDEX IF NOT EXISTS "warehouse_stocks_productId_idx" ON "warehouse_stocks" ("productId");

CREATE TABLE IF NOT EXISTS "warehouse_documents" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kyivDay" TEXT NOT NULL,
  "fromStorageId" TEXT,
  "toStorageId" TEXT,
  "comment" TEXT,
  "source" TEXT NOT NULL DEFAULT 'kresco',
  "altegioTxId" INTEGER,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warehouse_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_documents_altegioTxId_key"
  ON "warehouse_documents" ("altegioTxId");
CREATE INDEX IF NOT EXISTS "warehouse_documents_type_idx" ON "warehouse_documents" ("type");
CREATE INDEX IF NOT EXISTS "warehouse_documents_status_idx" ON "warehouse_documents" ("status");
CREATE INDEX IF NOT EXISTS "warehouse_documents_source_idx" ON "warehouse_documents" ("source");
CREATE INDEX IF NOT EXISTS "warehouse_documents_kyivDay_idx" ON "warehouse_documents" ("kyivDay");
CREATE INDEX IF NOT EXISTS "warehouse_documents_occurredAt_idx" ON "warehouse_documents" ("occurredAt");

CREATE TABLE IF NOT EXISTS "warehouse_document_lines" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "costPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "comment" TEXT,

  CONSTRAINT "warehouse_document_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "warehouse_document_lines_documentId_idx" ON "warehouse_document_lines" ("documentId");
CREATE INDEX IF NOT EXISTS "warehouse_document_lines_productId_idx" ON "warehouse_document_lines" ("productId");

ALTER TABLE "warehouse_stocks"
  ADD CONSTRAINT "warehouse_stocks_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_stocks"
  ADD CONSTRAINT "warehouse_stocks_storageId_fkey"
  FOREIGN KEY ("storageId") REFERENCES "warehouse_storages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "warehouse_documents"
  ADD CONSTRAINT "warehouse_documents_fromStorageId_fkey"
  FOREIGN KEY ("fromStorageId") REFERENCES "warehouse_storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_documents"
  ADD CONSTRAINT "warehouse_documents_toStorageId_fkey"
  FOREIGN KEY ("toStorageId") REFERENCES "warehouse_storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "warehouse_document_lines"
  ADD CONSTRAINT "warehouse_document_lines_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "warehouse_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouse_document_lines"
  ADD CONSTRAINT "warehouse_document_lines_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
