-- AlterTable
ALTER TABLE "direct_clients"
ADD COLUMN IF NOT EXISTS "paidServiceTotalCost" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_clients_paidServiceTotalCost_idx" ON "direct_clients"("paidServiceTotalCost");

