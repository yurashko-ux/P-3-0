-- Зведення вихідних банківських платежів з фінансовими операціями Altegio.

CREATE TABLE "altegio_finance_transactions" (
    "id" TEXT NOT NULL,
    "altegioId" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT,
    "accountTitle" TEXT,
    "documentId" INTEGER,
    "expenseId" INTEGER,
    "operationDate" TIMESTAMP(3) NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "amountKopiykas" BIGINT NOT NULL,
    "direction" TEXT NOT NULL,
    "categoryTitle" TEXT,
    "paymentPurpose" TEXT,
    "comment" TEXT,
    "counterpartyName" TEXT,
    "sourceEndpoint" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "deletedInAltegio" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "altegio_finance_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "altegio_payment_purposes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'expense',
    "rawData" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "altegio_payment_purposes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "altegio_finance_sync_states" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "syncKey" TEXT NOT NULL,
    "lastSyncedFrom" TIMESTAMP(3),
    "lastSyncedTo" TIMESTAMP(3),
    "lastPage" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "lastError" TEXT,
    "syncedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "altegio_finance_sync_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_altegio_pending_payments" (
    "id" TEXT NOT NULL,
    "bankStatementItemId" TEXT NOT NULL,
    "purposeId" TEXT,
    "purposeTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_altegio_document',
    "createdFrom" TEXT NOT NULL DEFAULT 'telegram',
    "telegramChatId" BIGINT,
    "telegramMessageId" INTEGER,
    "createdBy" TEXT,
    "linkedMatchId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_altegio_pending_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_altegio_payment_matches" (
    "id" TEXT NOT NULL,
    "bankStatementItemId" TEXT NOT NULL,
    "altegioFinanceTransactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'needs_review',
    "matchType" TEXT NOT NULL DEFAULT 'system',
    "matchScore" INTEGER,
    "matchedAt" TIMESTAMP(3),
    "matchedBy" TEXT,
    "reviewNote" TEXT,
    "conflictData" JSONB,
    "telegramNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_altegio_payment_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "altegio_finance_transactions_companyId_altegioId_key" ON "altegio_finance_transactions"("companyId", "altegioId");
CREATE INDEX "altegio_finance_transactions_companyId_idx" ON "altegio_finance_transactions"("companyId");
CREATE INDEX "altegio_finance_transactions_accountId_idx" ON "altegio_finance_transactions"("accountId");
CREATE INDEX "altegio_finance_transactions_operationDate_idx" ON "altegio_finance_transactions"("operationDate");
CREATE INDEX "altegio_finance_transactions_kyivDay_idx" ON "altegio_finance_transactions"("kyivDay");
CREATE INDEX "altegio_finance_transactions_direction_idx" ON "altegio_finance_transactions"("direction");
CREATE INDEX "altegio_finance_transactions_amountKopiykas_idx" ON "altegio_finance_transactions"("amountKopiykas");

CREATE UNIQUE INDEX "altegio_payment_purposes_companyId_normalizedTitle_key" ON "altegio_payment_purposes"("companyId", "normalizedTitle");
CREATE INDEX "altegio_payment_purposes_companyId_idx" ON "altegio_payment_purposes"("companyId");
CREATE INDEX "altegio_payment_purposes_externalId_idx" ON "altegio_payment_purposes"("externalId");
CREATE INDEX "altegio_payment_purposes_isActive_idx" ON "altegio_payment_purposes"("isActive");

CREATE UNIQUE INDEX "altegio_finance_sync_states_companyId_syncKey_key" ON "altegio_finance_sync_states"("companyId", "syncKey");
CREATE INDEX "altegio_finance_sync_states_status_idx" ON "altegio_finance_sync_states"("status");

CREATE UNIQUE INDEX "bank_altegio_pending_payments_bankStatementItemId_key" ON "bank_altegio_pending_payments"("bankStatementItemId");
CREATE INDEX "bank_altegio_pending_payments_purposeId_idx" ON "bank_altegio_pending_payments"("purposeId");
CREATE INDEX "bank_altegio_pending_payments_status_idx" ON "bank_altegio_pending_payments"("status");
CREATE INDEX "bank_altegio_pending_payments_createdAt_idx" ON "bank_altegio_pending_payments"("createdAt");

CREATE UNIQUE INDEX "bank_altegio_payment_matches_bankStatementItemId_key" ON "bank_altegio_payment_matches"("bankStatementItemId");
CREATE UNIQUE INDEX "bank_altegio_payment_matches_altegioFinanceTransactionId_key" ON "bank_altegio_payment_matches"("altegioFinanceTransactionId");
CREATE INDEX "bank_altegio_payment_matches_status_idx" ON "bank_altegio_payment_matches"("status");
CREATE INDEX "bank_altegio_payment_matches_matchType_idx" ON "bank_altegio_payment_matches"("matchType");
CREATE INDEX "bank_altegio_payment_matches_matchedAt_idx" ON "bank_altegio_payment_matches"("matchedAt");

ALTER TABLE "bank_altegio_pending_payments" ADD CONSTRAINT "bank_altegio_pending_payments_bankStatementItemId_fkey" FOREIGN KEY ("bankStatementItemId") REFERENCES "bank_statement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_altegio_pending_payments" ADD CONSTRAINT "bank_altegio_pending_payments_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "altegio_payment_purposes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_altegio_pending_payments" ADD CONSTRAINT "bank_altegio_pending_payments_linkedMatchId_fkey" FOREIGN KEY ("linkedMatchId") REFERENCES "bank_altegio_payment_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_altegio_payment_matches" ADD CONSTRAINT "bank_altegio_payment_matches_bankStatementItemId_fkey" FOREIGN KEY ("bankStatementItemId") REFERENCES "bank_statement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_altegio_payment_matches" ADD CONSTRAINT "bank_altegio_payment_matches_altegioFinanceTransactionId_fkey" FOREIGN KEY ("altegioFinanceTransactionId") REFERENCES "altegio_finance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
