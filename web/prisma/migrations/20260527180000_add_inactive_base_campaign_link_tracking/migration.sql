-- Посилання кампанії неактивної бази + трекінг кліків
ALTER TABLE "inactive_base_campaigns"
ADD COLUMN IF NOT EXISTS "linkLabel" TEXT,
ADD COLUMN IF NOT EXISTS "linkUrl" TEXT;

CREATE TABLE IF NOT EXISTS "inactive_base_campaign_link_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "firstClickedAt" TIMESTAMP(3),
    "lastClickedAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inactive_base_campaign_link_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inactive_base_campaign_link_tokens_token_key"
ON "inactive_base_campaign_link_tokens"("token");

CREATE UNIQUE INDEX IF NOT EXISTS "inactive_base_campaign_link_tokens_campaignId_clientId_key"
ON "inactive_base_campaign_link_tokens"("campaignId", "clientId");

CREATE INDEX IF NOT EXISTS "inactive_base_campaign_link_tokens_campaignId_idx"
ON "inactive_base_campaign_link_tokens"("campaignId");

CREATE INDEX IF NOT EXISTS "inactive_base_campaign_link_tokens_clientId_idx"
ON "inactive_base_campaign_link_tokens"("clientId");
