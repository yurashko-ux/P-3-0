-- Store receivedAt for the anchored message (to match ManyChat API/webhook messages by timestamp)
ALTER TABLE "direct_clients" ADD COLUMN "chatStatusAnchorMessageReceivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "direct_clients_chatStatusAnchorMessageReceivedAt_idx"
  ON "direct_clients"("chatStatusAnchorMessageReceivedAt");

