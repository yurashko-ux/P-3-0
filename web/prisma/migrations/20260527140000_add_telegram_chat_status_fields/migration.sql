-- Статуси переписки Telegram (окремо від Instagram) + channel у логах
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "telegramChatStatusId" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "telegramChatStatusSetAt" TIMESTAMP(3);
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "telegramChatStatusCheckedAt" TIMESTAMP(3);
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "telegramChatStatusAnchorMessageId" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "telegramChatStatusAnchorMessageReceivedAt" TIMESTAMP(3);
ALTER TABLE "direct_clients" ADD COLUMN IF NOT EXISTS "telegramChatStatusAnchorSetAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "direct_clients_telegramChatStatusId_idx" ON "direct_clients"("telegramChatStatusId");
CREATE INDEX IF NOT EXISTS "direct_clients_telegramChatStatusCheckedAt_idx" ON "direct_clients"("telegramChatStatusCheckedAt");

ALTER TABLE "direct_clients" DROP CONSTRAINT IF EXISTS "direct_clients_telegramChatStatusId_fkey";
ALTER TABLE "direct_clients" ADD CONSTRAINT "direct_clients_telegramChatStatusId_fkey" FOREIGN KEY ("telegramChatStatusId") REFERENCES "direct_chat_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "direct_client_chat_status_logs" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'instagram';
CREATE INDEX IF NOT EXISTS "direct_client_chat_status_logs_clientId_channel_idx" ON "direct_client_chat_status_logs"("clientId", "channel");
