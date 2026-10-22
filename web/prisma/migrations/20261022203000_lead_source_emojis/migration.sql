-- Емодзі першого вхідного повідомлення → джерело ліда.
-- Біля хмарки лишається один LeadSource.mark. Старих лідів ця таблиця не переписує.
CREATE TABLE "lead_source_emojis" (
    "id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "sourceCode" TEXT,
    "lastUsername" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_source_emojis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_source_emojis_emoji_key" ON "lead_source_emojis"("emoji");
CREATE INDEX "lead_source_emojis_sourceCode_idx" ON "lead_source_emojis"("sourceCode");

ALTER TABLE "lead_source_emojis" ADD CONSTRAINT "lead_source_emojis_sourceCode_fkey" FOREIGN KEY ("sourceCode") REFERENCES "lead_sources"("code") ON DELETE SET NULL ON UPDATE CASCADE;
