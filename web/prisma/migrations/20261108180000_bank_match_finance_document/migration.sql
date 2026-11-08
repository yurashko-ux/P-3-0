-- Зведення банківського платежу з документом Креско (поруч з операцією Altegio на перехідний період).
ALTER TABLE "bank_altegio_payment_matches" ADD COLUMN IF NOT EXISTS "financeDocumentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "bank_altegio_payment_matches_financeDocumentId_key"
  ON "bank_altegio_payment_matches"("financeDocumentId");
DO $$ BEGIN
  ALTER TABLE "bank_altegio_payment_matches"
    ADD CONSTRAINT "bank_altegio_payment_matches_financeDocumentId_fkey"
    FOREIGN KEY ("financeDocumentId") REFERENCES "finance_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
