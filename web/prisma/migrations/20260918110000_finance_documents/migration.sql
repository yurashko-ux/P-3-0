-- Етап 6: фінансові документи Kresco (прихід / розхід / переказ)

CREATE TABLE IF NOT EXISTS "finance_documents" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "syncError" TEXT,
    "source" TEXT NOT NULL DEFAULT 'kresco',
    "title" TEXT,
    "amountUah" DOUBLE PRECISION NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" INTEGER NOT NULL,
    "accountTitle" TEXT,
    "counterAccountId" INTEGER,
    "counterAccountTitle" TEXT,
    "purposeId" TEXT,
    "purposeTitle" TEXT,
    "purposeExternalId" INTEGER,
    "comment" TEXT,
    "createdBy" TEXT,
    "altegioTransactionId" INTEGER,
    "altegioCounterTransactionId" INTEGER,
    "localAltegioTxId" TEXT,
    "localAltegioCounterTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "finance_documents_type_idx" ON "finance_documents"("type");
CREATE INDEX IF NOT EXISTS "finance_documents_status_idx" ON "finance_documents"("status");
CREATE INDEX IF NOT EXISTS "finance_documents_syncStatus_idx" ON "finance_documents"("syncStatus");
CREATE INDEX IF NOT EXISTS "finance_documents_kyivDay_idx" ON "finance_documents"("kyivDay");
CREATE INDEX IF NOT EXISTS "finance_documents_occurredAt_idx" ON "finance_documents"("occurredAt");
CREATE INDEX IF NOT EXISTS "finance_documents_accountId_idx" ON "finance_documents"("accountId");
CREATE INDEX IF NOT EXISTS "finance_documents_source_idx" ON "finance_documents"("source");
