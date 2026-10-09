-- Касовка долара і євро та проводка готівкових платежів збіжною касовкою.

ALTER TABLE "cash_till_counts" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'UAH';
ALTER TABLE "cash_till_counts" ADD COLUMN "matchedBook" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "cash_till_counts_accountId_matchedBook_idx" ON "cash_till_counts"("accountId", "matchedBook");

CREATE TABLE "cash_till_postings" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_till_postings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_till_postings_sourceType_sourceId_accountId_key" ON "cash_till_postings"("sourceType", "sourceId", "accountId");
CREATE INDEX "cash_till_postings_accountId_idx" ON "cash_till_postings"("accountId");
CREATE INDEX "cash_till_postings_countId_idx" ON "cash_till_postings"("countId");

ALTER TABLE "cash_till_postings" ADD CONSTRAINT "cash_till_postings_countId_fkey" FOREIGN KEY ("countId") REFERENCES "cash_till_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
