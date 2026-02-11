-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "consultationDeletedInAltegio" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_clients_consultationDeletedInAltegio_idx" ON "direct_clients"("consultationDeletedInAltegio");
