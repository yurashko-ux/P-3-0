-- Внутрішній номер банківського платежу: 00001 і далі за часом.

ALTER TABLE "bank_statement_items" ADD COLUMN "paymentNumber" INTEGER;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY time ASC, id ASC) AS n
  FROM "bank_statement_items"
)
UPDATE "bank_statement_items" AS item
SET "paymentNumber" = numbered.n
FROM numbered
WHERE item.id = numbered.id;

ALTER TABLE "bank_statement_items" ALTER COLUMN "paymentNumber" SET NOT NULL;

CREATE UNIQUE INDEX "bank_statement_items_paymentNumber_key" ON "bank_statement_items"("paymentNumber");
