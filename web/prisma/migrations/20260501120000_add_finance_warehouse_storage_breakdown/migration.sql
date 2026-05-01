-- Залишки по складах для щомісячного snapshot (блок №4 фінансового звіту)
ALTER TABLE "finance_warehouse_balance_snapshots"
ADD COLUMN IF NOT EXISTS "storageBreakdown" JSONB;
