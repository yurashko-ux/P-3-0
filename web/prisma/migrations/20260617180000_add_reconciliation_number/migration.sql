-- Постійний № зведення для кожного auto/manual match (не порядковий номер у таблиці).
ALTER TABLE "bank_altegio_payment_matches" ADD COLUMN "reconciliation_number" INTEGER;

WITH "ordered" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      ORDER BY "matched_at" ASC NULLS LAST, "created_at" ASC
    ) AS "num"
  FROM "bank_altegio_payment_matches"
  WHERE "status" IN ('auto_matched', 'manual_matched')
)
UPDATE "bank_altegio_payment_matches" AS "m"
SET "reconciliation_number" = "ordered"."num"
FROM "ordered"
WHERE "m"."id" = "ordered"."id";

CREATE UNIQUE INDEX "bank_altegio_payment_matches_reconciliation_number_key"
  ON "bank_altegio_payment_matches"("reconciliation_number");
