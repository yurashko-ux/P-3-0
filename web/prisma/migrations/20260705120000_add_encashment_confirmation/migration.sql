-- CreateTable
CREATE TABLE "encashment_confirmations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "altegioId" INTEGER NOT NULL,
    "altegioFinanceTransactionId" TEXT,
    "reportYear" INTEGER NOT NULL,
    "reportMonth" INTEGER NOT NULL,
    "accountBucket" TEXT NOT NULL,
    "amountKopiykas" BIGINT NOT NULL,
    "foreignAmount" DECIMAL(18,4),
    "foreignCurrency" TEXT,
    "accountTitle" TEXT,
    "operationDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_owner',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" TEXT,
    "ownerConfirmedAt" TIMESTAMP(3),
    "ownerConfirmedByChatId" BIGINT,
    "telegramOwnerMessageId" INTEGER,
    "telegramOwnerChatId" BIGINT,
    "bankStatementItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encashment_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encashment_period_statuses" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encashment_period_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encashment_confirmations_companyId_altegioId_key" ON "encashment_confirmations"("companyId", "altegioId");

-- CreateIndex
CREATE INDEX "encashment_confirmations_reportYear_reportMonth_idx" ON "encashment_confirmations"("reportYear", "reportMonth");

-- CreateIndex
CREATE INDEX "encashment_confirmations_status_idx" ON "encashment_confirmations"("status");

-- CreateIndex
CREATE INDEX "encashment_confirmations_accountBucket_idx" ON "encashment_confirmations"("accountBucket");

-- CreateIndex
CREATE UNIQUE INDEX "encashment_period_statuses_year_month_key" ON "encashment_period_statuses"("year", "month");

-- AddForeignKey
ALTER TABLE "encashment_confirmations" ADD CONSTRAINT "encashment_confirmations_altegioFinanceTransactionId_fkey" FOREIGN KEY ("altegioFinanceTransactionId") REFERENCES "altegio_finance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
