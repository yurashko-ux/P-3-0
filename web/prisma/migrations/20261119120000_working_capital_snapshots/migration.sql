-- Щоденні знімки обігових коштів для графіка дашборду.
CREATE TABLE IF NOT EXISTS "working_capital_snapshots" (
    "id" TEXT NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "usdRate" DOUBLE PRECISION NOT NULL,
    "eurRate" DOUBLE PRECISION NOT NULL,
    "hairUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goodsUah" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashUah" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bankUah" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bankUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bankEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositsUah" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalUsd" DOUBLE PRECISION NOT NULL,
    "ownUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "working_capital_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "working_capital_snapshots_kyivDay_key" ON "working_capital_snapshots"("kyivDay");
