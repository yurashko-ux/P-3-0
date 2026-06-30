-- Автоматичні вихідні платежі в Altegio (еквайринг-комісія, термінал).

ALTER TABLE "bank_accounts"
ADD COLUMN "automaticTerminalFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "automaticTerminalFeeKopiykas" BIGINT,
ADD COLUMN "automaticTerminalFeeDayOfMonth" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "bank_automatic_altegio_expenses" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bankStatementItemId" TEXT,
    "bankAccountId" TEXT NOT NULL,
    "kyivMonth" TEXT,
    "amountKopiykas" BIGINT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "altegioFinanceTransactionId" TEXT,
    "altegioTransactionId" INTEGER,
    "telegramNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_automatic_altegio_expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_automatic_altegio_expenses_bankStatementItemId_key" ON "bank_automatic_altegio_expenses"("bankStatementItemId");

CREATE UNIQUE INDEX "bank_automatic_altegio_expenses_bankAccountId_kind_kyivMonth_key" ON "bank_automatic_altegio_expenses"("bankAccountId", "kind", "kyivMonth");

CREATE INDEX "bank_automatic_altegio_expenses_kind_idx" ON "bank_automatic_altegio_expenses"("kind");

CREATE INDEX "bank_automatic_altegio_expenses_status_idx" ON "bank_automatic_altegio_expenses"("status");

CREATE INDEX "bank_automatic_altegio_expenses_kyivMonth_idx" ON "bank_automatic_altegio_expenses"("kyivMonth");

ALTER TABLE "bank_automatic_altegio_expenses" ADD CONSTRAINT "bank_automatic_altegio_expenses_bankStatementItemId_fkey" FOREIGN KEY ("bankStatementItemId") REFERENCES "bank_statement_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_automatic_altegio_expenses" ADD CONSTRAINT "bank_automatic_altegio_expenses_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_automatic_altegio_expenses" ADD CONSTRAINT "bank_automatic_altegio_expenses_altegioFinanceTransactionId_fkey" FOREIGN KEY ("altegioFinanceTransactionId") REFERENCES "altegio_finance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
