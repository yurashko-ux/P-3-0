-- Окремі набори статусів переписки: client (Direct) та lead (сторінка Ліди).
ALTER TABLE "direct_chat_statuses" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'client';
CREATE INDEX IF NOT EXISTS "direct_chat_statuses_scope_idx" ON "direct_chat_statuses"("scope");
