-- Додаємо поля для статусів переписки до direct_clients
ALTER TABLE "direct_clients"
  ADD COLUMN "chatStatusId" TEXT,
  ADD COLUMN "chatStatusSetAt" TIMESTAMP(3),
  ADD COLUMN "chatStatusCheckedAt" TIMESTAMP(3);

-- Таблиця статусів переписки
CREATE TABLE "direct_chat_statuses" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#6b7280',
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "direct_chat_statuses_pkey" PRIMARY KEY ("id")
);

-- Таблиця історії змін статусів переписки
CREATE TABLE "direct_client_chat_status_logs" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "fromStatusId" TEXT,
  "toStatusId" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedBy" TEXT,
  "note" TEXT,
  CONSTRAINT "direct_client_chat_status_logs_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "direct_clients"
  ADD CONSTRAINT "direct_clients_chatStatusId_fkey"
  FOREIGN KEY ("chatStatusId") REFERENCES "direct_chat_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "direct_client_chat_status_logs"
  ADD CONSTRAINT "direct_client_chat_status_logs_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "direct_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_client_chat_status_logs"
  ADD CONSTRAINT "direct_client_chat_status_logs_fromStatusId_fkey"
  FOREIGN KEY ("fromStatusId") REFERENCES "direct_chat_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "direct_client_chat_status_logs"
  ADD CONSTRAINT "direct_client_chat_status_logs_toStatusId_fkey"
  FOREIGN KEY ("toStatusId") REFERENCES "direct_chat_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "direct_clients_chatStatusId_idx" ON "direct_clients"("chatStatusId");
CREATE INDEX "direct_clients_chatStatusCheckedAt_idx" ON "direct_clients"("chatStatusCheckedAt");

CREATE INDEX "direct_chat_statuses_order_idx" ON "direct_chat_statuses"("order");
CREATE INDEX "direct_chat_statuses_isActive_idx" ON "direct_chat_statuses"("isActive");

CREATE INDEX "direct_client_chat_status_logs_clientId_idx" ON "direct_client_chat_status_logs"("clientId");
CREATE INDEX "direct_client_chat_status_logs_changedAt_idx" ON "direct_client_chat_status_logs"("changedAt");

