-- Борг постачальникам: прийомка в борг і оплати боргу.
ALTER TABLE "warehouse_documents" ADD COLUMN IF NOT EXISTS "supplierName" TEXT;
ALTER TABLE "warehouse_documents" ADD COLUMN IF NOT EXISTS "onCredit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "working_capital_snapshots" ADD COLUMN IF NOT EXISTS "supplierDebtUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "supplier_payments" (
    "id" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DOUBLE PRECISION NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "comment" TEXT,
    "createdBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_payments_supplierName_idx" ON "supplier_payments"("supplierName");
CREATE INDEX IF NOT EXISTS "supplier_payments_kyivDay_idx" ON "supplier_payments"("kyivDay");
