-- № зведення для вхідних платежів (розділ Банк), з 01.07.2026.
ALTER TABLE "bank_altegio_incoming_matches"
  ADD COLUMN IF NOT EXISTS "reconciliationNumber" INTEGER;

WITH "max_num" AS (
  SELECT GREATEST(
    COALESCE((SELECT MAX("reconciliationNumber") FROM "bank_altegio_payment_matches"), 0),
    COALESCE((SELECT MAX("reconciliationNumber") FROM "bank_altegio_incoming_matches"), 0)
  ) AS "base"
),
"ordered" AS (
  SELECT
    "m"."id",
    "max_num"."base" + ROW_NUMBER() OVER (
      ORDER BY "m"."matchedAt" ASC, "m"."createdAt" ASC
    ) AS "num"
  FROM "bank_altegio_incoming_matches" AS "m"
  CROSS JOIN "max_num"
  WHERE "m"."status" IN ('auto_matched', 'manual_matched')
    AND "m"."kyivDay" >= '2026-07-01'
    AND "m"."reconciliationNumber" IS NULL
)
UPDATE "bank_altegio_incoming_matches" AS "m"
SET "reconciliationNumber" = "ordered"."num"
FROM "ordered"
WHERE "m"."id" = "ordered"."id";

CREATE UNIQUE INDEX IF NOT EXISTS "bank_altegio_incoming_matches_reconciliationNumber_key"
  ON "bank_altegio_incoming_matches"("reconciliationNumber");
