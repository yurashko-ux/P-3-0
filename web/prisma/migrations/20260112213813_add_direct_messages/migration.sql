-- CreateTable
CREATE TABLE IF NOT EXISTS "direct_messages" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "messageId" TEXT,
    "subscriberId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manychat',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_messages_clientId_idx" ON "direct_messages"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_messages_direction_idx" ON "direct_messages"("direction");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_messages_receivedAt_idx" ON "direct_messages"("receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_messages_messageId_idx" ON "direct_messages"("messageId");

-- AddForeignKey
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'direct_messages_clientId_fkey'
    ) THEN
        ALTER TABLE "direct_messages" 
        ADD CONSTRAINT "direct_messages_clientId_fkey" 
        FOREIGN KEY ("clientId") 
        REFERENCES "direct_clients"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
