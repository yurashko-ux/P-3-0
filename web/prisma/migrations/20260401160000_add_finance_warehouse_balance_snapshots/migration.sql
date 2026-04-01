CREATE TABLE IF NOT EXISTS "finance_warehouse_balance_snapshots" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "totalBalance" DOUBLE PRECISION NOT NULL,
  "snapshotAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "finance_warehouse_balance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "finance_warehouse_balance_snapshots_year_month_key"
  ON "finance_warehouse_balance_snapshots" ("year", "month");

CREATE INDEX IF NOT EXISTS "finance_warehouse_balance_snapshots_snapshotAt_idx"
  ON "finance_warehouse_balance_snapshots" ("snapshotAt");
