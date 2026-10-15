-- Видимість журналу в Telegram-боті /master: хто кого бачить (ручний список, не роль).
CREATE TABLE "team_member_journal_visibility" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_member_journal_visibility_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "team_member_journal_visibility_viewerId_idx" ON "team_member_journal_visibility"("viewerId");

CREATE INDEX "team_member_journal_visibility_targetId_idx" ON "team_member_journal_visibility"("targetId");

CREATE UNIQUE INDEX "team_member_journal_visibility_viewerId_targetId_key" ON "team_member_journal_visibility"("viewerId", "targetId");

ALTER TABLE "team_member_journal_visibility" ADD CONSTRAINT "team_member_journal_visibility_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "team_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_member_journal_visibility" ADD CONSTRAINT "team_member_journal_visibility_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "team_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
