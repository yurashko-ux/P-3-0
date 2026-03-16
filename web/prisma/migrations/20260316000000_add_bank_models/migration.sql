-- CreateTable
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "clientName" TEXT,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" INTEGER NOT NULL DEFAULT 980,
    "type" TEXT,
    "iban" TEXT,
    "maskedPan" TEXT,
    "sendId" TEXT,
    "cashbackType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_items" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "amount" BIGINT NOT NULL,
    "balance" BIGINT,
    "hold" BOOLEAN NOT NULL DEFAULT false,
    "mcc" INTEGER,
    "operationAmount" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_connections_provider_idx" ON "bank_connections"("provider");

-- CreateIndex
CREATE INDEX "bank_accounts_connectionId_idx" ON "bank_accounts"("connectionId");

-- CreateIndex
CREATE INDEX "bank_accounts_externalId_idx" ON "bank_accounts"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_connectionId_externalId_key" ON "bank_accounts"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "bank_statement_items_accountId_idx" ON "bank_statement_items"("accountId");

-- CreateIndex
CREATE INDEX "bank_statement_items_time_idx" ON "bank_statement_items"("time");

-- CreateIndex
CREATE INDEX "bank_statement_items_externalId_idx" ON "bank_statement_items"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_items_accountId_externalId_key" ON "bank_statement_items"("accountId", "externalId");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_items" ADD CONSTRAINT "bank_statement_items_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
