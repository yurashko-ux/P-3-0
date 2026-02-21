-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "paidServiceIsRebooking" BOOLEAN;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_clients_paidServiceIsRebooking_idx" ON "direct_clients"("paidServiceIsRebooking");
