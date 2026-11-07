-- Валютні документи: сума у валюті рахунку поруч із гривневим еквівалентом.
ALTER TABLE "finance_documents" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'UAH';
ALTER TABLE "finance_documents" ADD COLUMN IF NOT EXISTS "amountFx" DOUBLE PRECISION;
ALTER TABLE "finance_documents" ADD COLUMN IF NOT EXISTS "counterCurrency" TEXT;
ALTER TABLE "finance_documents" ADD COLUMN IF NOT EXISTS "counterAmountFx" DOUBLE PRECISION;
