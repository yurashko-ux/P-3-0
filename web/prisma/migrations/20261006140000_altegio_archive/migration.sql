-- Архів Altegio: клієнти, оплати візитів, курсор батчів і звірка місяців.
-- Не змінює direct_clients і finance_operations.

CREATE TABLE IF NOT EXISTS "altegio_client_archive" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "altegioClientId" INTEGER NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "spent" DOUBLE PRECISION,
    "visits" INTEGER,
    "lastVisitAt" TIMESTAMP(3),
    "directClientId" TEXT,
    "rawData" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "altegio_client_archive_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "altegio_client_archive_companyId_altegioClientId_key"
  ON "altegio_client_archive"("companyId", "altegioClientId");
CREATE INDEX IF NOT EXISTS "altegio_client_archive_companyId_idx" ON "altegio_client_archive"("companyId");
CREATE INDEX IF NOT EXISTS "altegio_client_archive_name_idx" ON "altegio_client_archive"("name");
CREATE INDEX IF NOT EXISTS "altegio_client_archive_phone_idx" ON "altegio_client_archive"("phone");
CREATE INDEX IF NOT EXISTS "altegio_client_archive_directClientId_idx" ON "altegio_client_archive"("directClientId");

ALTER TABLE "altegio_client_archive"
  ADD CONSTRAINT "altegio_client_archive_directClientId_fkey"
  FOREIGN KEY ("directClientId") REFERENCES "direct_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "altegio_visit_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "altegioRecordId" INTEGER NOT NULL,
    "txKey" TEXT NOT NULL,
    "altegioTransactionId" INTEGER,
    "appointmentId" TEXT,
    "altegioClientId" INTEGER,
    "clientName" TEXT,
    "kyivDay" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "method" TEXT,
    "staffId" INTEGER,
    "staffName" TEXT,
    "serviceTitle" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "rawData" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "altegio_visit_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "altegio_visit_payments_companyId_altegioRecordId_txKey_key"
  ON "altegio_visit_payments"("companyId", "altegioRecordId", "txKey");
CREATE INDEX IF NOT EXISTS "altegio_visit_payments_companyId_idx" ON "altegio_visit_payments"("companyId");
CREATE INDEX IF NOT EXISTS "altegio_visit_payments_altegioRecordId_idx" ON "altegio_visit_payments"("altegioRecordId");
CREATE INDEX IF NOT EXISTS "altegio_visit_payments_altegioClientId_idx" ON "altegio_visit_payments"("altegioClientId");
CREATE INDEX IF NOT EXISTS "altegio_visit_payments_kyivDay_idx" ON "altegio_visit_payments"("kyivDay");
CREATE INDEX IF NOT EXISTS "altegio_visit_payments_appointmentId_idx" ON "altegio_visit_payments"("appointmentId");

CREATE TABLE IF NOT EXISTS "altegio_visit_payment_scans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "altegioRecordId" INTEGER NOT NULL,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "altegio_visit_payment_scans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "altegio_visit_payment_scans_companyId_altegioRecordId_key"
  ON "altegio_visit_payment_scans"("companyId", "altegioRecordId");
CREATE INDEX IF NOT EXISTS "altegio_visit_payment_scans_companyId_idx" ON "altegio_visit_payment_scans"("companyId");

CREATE TABLE IF NOT EXISTS "altegio_archive_cursors" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "syncKey" TEXT NOT NULL,
    "cursor" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "detail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "altegio_archive_cursors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "altegio_archive_cursors_companyId_syncKey_key"
  ON "altegio_archive_cursors"("companyId", "syncKey");
CREATE INDEX IF NOT EXISTS "altegio_archive_cursors_status_idx" ON "altegio_archive_cursors"("status");

CREATE TABLE IF NOT EXISTS "altegio_archive_month_checks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kyivMonth" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "apiCount" INTEGER NOT NULL DEFAULT 0,
    "dbCount" INTEGER NOT NULL DEFAULT 0,
    "dbAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "altegio_archive_month_checks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "altegio_archive_month_checks_companyId_kyivMonth_kind_key"
  ON "altegio_archive_month_checks"("companyId", "kyivMonth", "kind");
CREATE INDEX IF NOT EXISTS "altegio_archive_month_checks_companyId_idx" ON "altegio_archive_month_checks"("companyId");
CREATE INDEX IF NOT EXISTS "altegio_archive_month_checks_kind_idx" ON "altegio_archive_month_checks"("kind");
