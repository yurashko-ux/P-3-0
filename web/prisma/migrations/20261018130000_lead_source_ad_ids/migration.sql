-- ad_id конкретного оголошення Meta (referral) → джерело ліда. Надійніша ідентифікація
-- рекламного кабінету за реальним ID оголошення, замість знаку в тексті.
ALTER TABLE "direct_clients" ADD COLUMN "leadAdId" TEXT;

CREATE INDEX "direct_clients_leadAdId_idx" ON "direct_clients"("leadAdId");

CREATE TABLE "lead_source_ad_ids" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adTitle" TEXT,
    "sourceCode" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_source_ad_ids_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_source_ad_ids_adId_key" ON "lead_source_ad_ids"("adId");

CREATE INDEX "lead_source_ad_ids_sourceCode_idx" ON "lead_source_ad_ids"("sourceCode");

ALTER TABLE "lead_source_ad_ids" ADD CONSTRAINT "lead_source_ad_ids_sourceCode_fkey" FOREIGN KEY ("sourceCode") REFERENCES "lead_sources"("code") ON DELETE SET NULL ON UPDATE CASCADE;
