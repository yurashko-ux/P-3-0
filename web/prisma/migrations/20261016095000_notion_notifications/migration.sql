-- Сповіщення Notion → Telegram: отримувачі, правила, знімок стану задачі, журнал подій.
CREATE TABLE "notification_recipients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "telegramChatId" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_rules" (
    "id" TEXT NOT NULL,
    "databaseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "propertyId" TEXT,
    "recipientId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notion_page_snapshots" (
    "pageId" TEXT NOT NULL,
    "databaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "assignee" TEXT NOT NULL DEFAULT '',
    "deadline" TEXT NOT NULL DEFAULT '',
    "notionUpdatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notion_page_snapshots_pkey" PRIMARY KEY ("pageId")
);

CREATE TABLE "notion_webhook_events" (
    "id" TEXT NOT NULL,
    "notionEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "pageId" TEXT,
    "databaseId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "notion_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notion_webhook_events_notionEventId_key" ON "notion_webhook_events"("notionEventId");
CREATE INDEX "notification_rules_recipientId_idx" ON "notification_rules"("recipientId");
CREATE INDEX "notification_rules_enabled_eventType_idx" ON "notification_rules"("enabled", "eventType");
CREATE INDEX "notion_page_snapshots_databaseId_idx" ON "notion_page_snapshots"("databaseId");
CREATE INDEX "notion_webhook_events_status_createdAt_idx" ON "notion_webhook_events"("status", "createdAt");

ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "notification_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Початковий отримувач і правила на всі 4 події обох баз.
INSERT INTO "notification_recipients" ("id", "name", "telegramChatId", "enabled", "createdAt", "updatedAt")
VALUES ('11111111-1111-4111-8111-111111111111', 'Микола', 395536991, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "notification_rules" ("id", "databaseId", "eventType", "propertyId", "recipientId", "enabled", "createdAt", "updatedAt")
VALUES
  ('22222222-2222-4222-8222-222222222221', '*', 'page.created', NULL, '11111111-1111-4111-8111-111111111111', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('22222222-2222-4222-8222-222222222222', '*', 'page.properties_updated', NULL, '11111111-1111-4111-8111-111111111111', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('22222222-2222-4222-8222-222222222223', '*', 'page.deleted', NULL, '11111111-1111-4111-8111-111111111111', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('22222222-2222-4222-8222-222222222224', '*', 'page.undeleted', NULL, '11111111-1111-4111-8111-111111111111', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
