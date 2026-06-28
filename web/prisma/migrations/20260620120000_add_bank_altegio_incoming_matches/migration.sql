-- Зведення вхідних банківських платежів з Altegio (безготівка).
CREATE TABLE "bank_altegio_incoming_matches" (
    "id" TEXT NOT NULL,
    "bankStatementItemId" TEXT NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'auto_matched',
    "matchType" TEXT NOT NULL DEFAULT 'account_total',
    "matchedAt" TIMESTAMP(3) NOT NULL,
    "matchedBy" TEXT,
    "reviewNote" TEXT,
    "acquiringExpenseTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_altegio_incoming_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_altegio_incoming_matches_bankStatementItemId_key" ON "bank_altegio_incoming_matches"("bankStatementItemId");

CREATE INDEX "bank_altegio_incoming_matches_kyivDay_idx" ON "bank_altegio_incoming_matches"("kyivDay");
CREATE INDEX "bank_altegio_incoming_matches_status_idx" ON "bank_altegio_incoming_matches"("status");
CREATE INDEX "bank_altegio_incoming_matches_matchedAt_idx" ON "bank_altegio_incoming_matches"("matchedAt");

ALTER TABLE "bank_altegio_incoming_matches" ADD CONSTRAINT "bank_altegio_incoming_matches_bankStatementItemId_fkey" FOREIGN KEY ("bankStatementItemId") REFERENCES "bank_statement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_altegio_incoming_matches" ADD CONSTRAINT "bank_altegio_incoming_matches_acquiringExpenseTransactionId_fkey" FOREIGN KEY ("acquiringExpenseTransactionId") REFERENCES "altegio_finance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
