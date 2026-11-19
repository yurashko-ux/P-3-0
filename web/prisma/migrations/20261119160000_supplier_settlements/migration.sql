-- Розрахунки з постачальниками: оплата в прийомці замість позначки «у борг».
ALTER TABLE "warehouse_documents" DROP COLUMN IF EXISTS "onCredit";
ALTER TABLE "warehouse_documents" ADD COLUMN IF NOT EXISTS "paymentPlan" JSONB;
ALTER TABLE "finance_documents" ADD COLUMN IF NOT EXISTS "supplierName" TEXT;
ALTER TABLE "finance_documents" ADD COLUMN IF NOT EXISTS "warehouseDocumentId" TEXT;
CREATE INDEX IF NOT EXISTS "finance_documents_warehouseDocumentId_idx" ON "finance_documents"("warehouseDocumentId");
