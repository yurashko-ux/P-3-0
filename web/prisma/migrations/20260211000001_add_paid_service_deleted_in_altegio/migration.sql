-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "paidServiceDeletedInAltegio" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_clients_paidServiceDeletedInAltegio_idx" ON "direct_clients"("paidServiceDeletedInAltegio");
