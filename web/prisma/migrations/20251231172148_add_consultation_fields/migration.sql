-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "consultationBookingDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "consultationAttended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "consultationMasterId" TEXT,
ADD COLUMN IF NOT EXISTS "consultationMasterName" TEXT,
ADD COLUMN IF NOT EXISTS "signedUpForPaidServiceAfterConsultation" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_clients_consultationBookingDate_idx" ON "direct_clients"("consultationBookingDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_clients_consultationAttended_idx" ON "direct_clients"("consultationAttended");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_clients_consultationMasterId_idx" ON "direct_clients"("consultationMasterId");

