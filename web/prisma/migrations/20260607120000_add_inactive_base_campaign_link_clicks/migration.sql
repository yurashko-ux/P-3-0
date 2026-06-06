-- Детальна історія кліків по посиланнях кампаній неактивної бази
CREATE TABLE IF NOT EXISTS "inactive_base_campaign_link_clicks" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inactive_base_campaign_link_clicks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inactive_base_campaign_link_clicks_tokenId_idx"
ON "inactive_base_campaign_link_clicks"("tokenId");

CREATE INDEX IF NOT EXISTS "inactive_base_campaign_link_clicks_clickedAt_idx"
ON "inactive_base_campaign_link_clicks"("clickedAt");

ALTER TABLE "inactive_base_campaign_link_clicks"
ADD CONSTRAINT "inactive_base_campaign_link_clicks_tokenId_fkey"
FOREIGN KEY ("tokenId") REFERENCES "inactive_base_campaign_link_tokens"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Ретро-запис: один клік на токен, якщо раніше фіксувалась лише агрегована статистика
INSERT INTO "inactive_base_campaign_link_clicks" ("id", "tokenId", "clickedAt")
SELECT
    'legacy_' || t."id",
    t."id",
    COALESCE(t."lastClickedAt", t."firstClickedAt", t."createdAt")
FROM "inactive_base_campaign_link_tokens" t
WHERE t."clickCount" > 0
ON CONFLICT DO NOTHING;
