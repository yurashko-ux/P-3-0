-- Архів даних Фінзвіту за закриті місяці: звіт відкривається і без Altegio.
CREATE TABLE IF NOT EXISTS "finance_report_archive" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "month" TEXT NOT NULL,
  "block" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_report_archive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "finance_report_archive_month_block_key" ON "finance_report_archive"("month", "block");
