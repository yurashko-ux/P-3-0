-- Anchor chat status changes to a specific message in history (for UI dot)
ALTER TABLE "direct_clients" ADD COLUMN "chatStatusAnchorMessageId" TEXT;
ALTER TABLE "direct_clients" ADD COLUMN "chatStatusAnchorSetAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "direct_clients_chatStatusAnchorMessageId_idx"
  ON "direct_clients"("chatStatusAnchorMessageId");

