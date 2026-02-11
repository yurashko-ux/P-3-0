-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN "consultationRecordCreatedAt" TIMESTAMP(3),
ADD COLUMN "paidServiceRecordCreatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "direct_clients_consultationRecordCreatedAt_idx" ON "direct_clients"("consultationRecordCreatedAt");
CREATE INDEX "direct_clients_paidServiceRecordCreatedAt_idx" ON "direct_clients"("paidServiceRecordCreatedAt");
