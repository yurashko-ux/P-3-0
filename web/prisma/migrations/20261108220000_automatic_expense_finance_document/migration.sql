-- Автоматичні витрати банку (комісія еквайрингу, термінал) — з документом Креско.
ALTER TABLE "bank_automatic_altegio_expenses" ADD COLUMN IF NOT EXISTS "financeDocumentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "bank_automatic_altegio_expenses_financeDocumentId_key"
  ON "bank_automatic_altegio_expenses"("financeDocumentId");
DO $$ BEGIN
  ALTER TABLE "bank_automatic_altegio_expenses"
    ADD CONSTRAINT "bank_automatic_altegio_expenses_financeDocumentId_fkey"
    FOREIGN KEY ("financeDocumentId") REFERENCES "finance_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
