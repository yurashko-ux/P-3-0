-- Постійний № зведення для кожного auto/manual match (ідемпотентно для повторного deploy).
ALTER TABLE "bank_altegio_payment_matches"
  ADD COLUMN IF NOT EXISTS "reconciliation_number" INTEGER;

WITH "max_num" AS (
  SELECT COALESCE(MAX("reconciliation_number"), 0) AS "base"
  FROM "bank_altegio_payment_matches"
),
"ordered" AS (
  SELECT
    "m"."id",
    "max_num"."base" + ROW_NUMBER() OVER (
      ORDER BY "m"."matched_at" ASC NULLS LAST, "m"."created_at" ASC
    ) AS "num"
  FROM "bank_altegio_payment_matches" AS "m"
  CROSS JOIN "max_num"
  WHERE "m"."status" IN ('auto_matched', 'manual_matched')
    AND "m"."reconciliation_number" IS NULL
)
UPDATE "bank_altegio_payment_matches" AS "m"
SET "reconciliation_number" = "ordered"."num"
FROM "ordered"
WHERE "m"."id" = "ordered"."id";

CREATE UNIQUE INDEX IF NOT EXISTS "bank_altegio_payment_matches_reconciliation_number_key"
  ON "bank_altegio_payment_matches"("reconciliation_number");
