-- Касовка гривневої каси і нічні знімки всіх рахунків.

CREATE TABLE "cash_till_counts" (
    "id" TEXT NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "accountTitle" TEXT NOT NULL,
    "countedUah" DOUBLE PRECISION NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "cash_till_counts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_till_counts_kyivDay_accountId_createdAt_idx" ON "cash_till_counts"("kyivDay", "accountId", "createdAt");

CREATE TABLE "cash_day_snapshots" (
    "kyivDay" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL,

    CONSTRAINT "cash_day_snapshots_pkey" PRIMARY KEY ("kyivDay")
);
