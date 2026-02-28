-- CreateTable
CREATE TABLE "direct_call_statuses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "badgeKey" TEXT NOT NULL DEFAULT 'badge_1',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "direct_call_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_client_call_status_logs" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fromStatusId" TEXT,
    "toStatusId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT,
    "note" TEXT,

    CONSTRAINT "direct_client_call_status_logs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callStatusId" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "callStatusSetAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "direct_call_statuses_order_idx" ON "direct_call_statuses"("order");
CREATE INDEX "direct_call_statuses_isActive_idx" ON "direct_call_statuses"("isActive");

-- CreateIndex
CREATE INDEX "direct_client_call_status_logs_clientId_idx" ON "direct_client_call_status_logs"("clientId");
CREATE INDEX "direct_client_call_status_logs_changedAt_idx" ON "direct_client_call_status_logs"("changedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_clients_callStatusId_idx" ON "direct_clients"("callStatusId");
CREATE INDEX IF NOT EXISTS "direct_clients_callStatusSetAt_idx" ON "direct_clients"("callStatusSetAt");

-- AddForeignKey
ALTER TABLE "direct_client_call_status_logs" ADD CONSTRAINT "direct_client_call_status_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "direct_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_client_call_status_logs" ADD CONSTRAINT "direct_client_call_status_logs_fromStatusId_fkey" FOREIGN KEY ("fromStatusId") REFERENCES "direct_call_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "direct_client_call_status_logs" ADD CONSTRAINT "direct_client_call_status_logs_toStatusId_fkey" FOREIGN KEY ("toStatusId") REFERENCES "direct_call_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "direct_clients" ADD CONSTRAINT "direct_clients_callStatusId_fkey" FOREIGN KEY ("callStatusId") REFERENCES "direct_call_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
