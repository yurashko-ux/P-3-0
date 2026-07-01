-- CreateTable
CREATE TABLE "bank_altegio_deposit_matches" (
    "id" TEXT NOT NULL,
    "altegioTransactionId" INTEGER NOT NULL,
    "bankStatementItemId" TEXT,
    "paymentKyivDay" TEXT NOT NULL,
    "displayKyivDay" TEXT NOT NULL,
    "appointmentAt" TIMESTAMP(3),
    "clientId" INTEGER,
    "payerName" TEXT NOT NULL,
    "amountKopiykas" BIGINT NOT NULL,
    "accountTitle" TEXT,
    "operationTime" TEXT,
    "status" TEXT NOT NULL DEFAULT 'auto_matched',
    "matchType" TEXT NOT NULL DEFAULT 'deposit',
    "matchedAt" TIMESTAMP(3) NOT NULL,
    "matchedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_altegio_deposit_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_altegio_deposit_matches_altegioTransactionId_key" ON "bank_altegio_deposit_matches"("altegioTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_altegio_deposit_matches_bankStatementItemId_key" ON "bank_altegio_deposit_matches"("bankStatementItemId");

-- CreateIndex
CREATE INDEX "bank_altegio_deposit_matches_displayKyivDay_idx" ON "bank_altegio_deposit_matches"("displayKyivDay");

-- CreateIndex
CREATE INDEX "bank_altegio_deposit_matches_paymentKyivDay_idx" ON "bank_altegio_deposit_matches"("paymentKyivDay");

-- CreateIndex
CREATE INDEX "bank_altegio_deposit_matches_status_idx" ON "bank_altegio_deposit_matches"("status");

-- CreateIndex
CREATE INDEX "bank_altegio_deposit_matches_matchedAt_idx" ON "bank_altegio_deposit_matches"("matchedAt");

-- AddForeignKey
ALTER TABLE "bank_altegio_deposit_matches" ADD CONSTRAINT "bank_altegio_deposit_matches_bankStatementItemId_fkey" FOREIGN KEY ("bankStatementItemId") REFERENCES "bank_statement_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
