-- Етап відмови від Altegio: власний довідник рахунків замість id рахунку Altegio.
-- Старі колонки accountId лишаються. Токен Altegio не потрібен: довідник збираємо з наших даних.

CREATE TABLE IF NOT EXISTS "finance_accounts" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "altegioAccountId" INTEGER,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'bank',
  "currencyCode" TEXT NOT NULL DEFAULT 'UAH',
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "finance_accounts_altegioAccountId_key" ON "finance_accounts"("altegioAccountId");
CREATE INDEX IF NOT EXISTS "finance_accounts_kind_idx" ON "finance_accounts"("kind");

ALTER TABLE "salon_checkout_payments" ADD COLUMN IF NOT EXISTS "financeAccountId" TEXT;
ALTER TABLE "finance_documents" ADD COLUMN IF NOT EXISTS "financeAccountId" TEXT;
ALTER TABLE "finance_documents" ADD COLUMN IF NOT EXISTS "counterFinanceAccountId" TEXT;
ALTER TABLE "cash_till_counts" ADD COLUMN IF NOT EXISTS "financeAccountId" TEXT;
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "financeAccountId" TEXT;

DO $$ BEGIN
  ALTER TABLE "salon_checkout_payments" ADD CONSTRAINT "salon_checkout_payments_financeAccountId_fkey"
    FOREIGN KEY ("financeAccountId") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_financeAccountId_fkey"
    FOREIGN KEY ("financeAccountId") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_counterFinanceAccountId_fkey"
    FOREIGN KEY ("counterFinanceAccountId") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cash_till_counts" ADD CONSTRAINT "cash_till_counts_financeAccountId_fkey"
    FOREIGN KEY ("financeAccountId") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_financeAccountId_fkey"
    FOREIGN KEY ("financeAccountId") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Те саме правило, що isCashAltegioAccount: Каса, Долар, Євро — готівка, решта — безготівка.
CREATE OR REPLACE FUNCTION kresco_ensure_finance_account(p_altegio_id INTEGER, p_title TEXT) RETURNS TEXT AS $$
DECLARE
  v_title TEXT := COALESCE(NULLIF(btrim(p_title), ''), 'Рахунок ' || p_altegio_id);
  v_norm TEXT := lower(btrim(COALESCE(p_title, '')));
  v_currency TEXT := 'UAH';
  v_kind TEXT := 'bank';
  v_id TEXT;
BEGIN
  IF p_altegio_id IS NULL OR p_altegio_id <= 0 THEN
    RETURN NULL;
  END IF;
  IF v_norm LIKE '%долар%' OR v_norm LIKE '%dollar%' THEN
    v_currency := 'USD';
    v_kind := 'cash';
  ELSIF v_norm LIKE '%євро%' OR v_norm LIKE '%евро%' OR v_norm LIKE '%euro%' THEN
    v_currency := 'EUR';
    v_kind := 'cash';
  ELSIF v_norm = 'каса' OR v_norm LIKE 'каса %' THEN
    v_kind := 'cash';
  END IF;

  SELECT "id" INTO v_id FROM "finance_accounts" WHERE "altegioAccountId" = p_altegio_id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO "finance_accounts" ("altegioAccountId", "title", "kind", "currencyCode")
  VALUES (p_altegio_id, v_title, v_kind, v_currency)
  ON CONFLICT ("altegioAccountId") DO UPDATE SET "altegioAccountId" = EXCLUDED."altegioAccountId"
  RETURNING "id" INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Довідник із наших даних. Спершу транзакції Altegio: там найповніші назви.
SELECT kresco_ensure_finance_account(s.id, s.title)
FROM (
  SELECT "accountId"::int AS id, max("accountTitle") AS title
  FROM "altegio_finance_transactions"
  WHERE "accountId" ~ '^[0-9]{1,9}$'
  GROUP BY 1
) s;
SELECT kresco_ensure_finance_account(s.id, s.title)
FROM (
  SELECT "altegioAccountId" AS id, max("title") AS title FROM "hidden_finance_accounts" GROUP BY 1
  UNION ALL
  SELECT "accountId", max("accountTitle") FROM "salon_checkout_payments" WHERE "paymentKind" <> 'deposit' GROUP BY 1
  UNION ALL
  SELECT "accountId", max("accountTitle") FROM "finance_documents" GROUP BY 1
  UNION ALL
  SELECT "counterAccountId", max("counterAccountTitle") FROM "finance_documents" WHERE "counterAccountId" IS NOT NULL GROUP BY 1
  UNION ALL
  SELECT "accountId", max("accountTitle") FROM "cash_till_counts" GROUP BY 1
  UNION ALL
  SELECT "altegioAccountId"::int, max("altegioAccountTitle") FROM "bank_accounts" WHERE "altegioAccountId" ~ '^[0-9]{1,9}$' GROUP BY 1
) s;

-- Приховані рахунки — це архів.
UPDATE "finance_accounts" f SET "archivedAt" = h."hiddenAt"
  FROM "hidden_finance_accounts" h
  WHERE f."altegioAccountId" = h."altegioAccountId" AND f."archivedAt" IS NULL;

-- Заповнення наявних рядків
UPDATE "salon_checkout_payments" t SET "financeAccountId" = f."id"
  FROM "finance_accounts" f
  WHERE t."financeAccountId" IS NULL AND t."paymentKind" <> 'deposit' AND f."altegioAccountId" = t."accountId";
UPDATE "finance_documents" t SET "financeAccountId" = f."id"
  FROM "finance_accounts" f
  WHERE t."financeAccountId" IS NULL AND f."altegioAccountId" = t."accountId";
UPDATE "finance_documents" t SET "counterFinanceAccountId" = f."id"
  FROM "finance_accounts" f
  WHERE t."counterFinanceAccountId" IS NULL AND f."altegioAccountId" = t."counterAccountId";
UPDATE "cash_till_counts" t SET "financeAccountId" = f."id"
  FROM "finance_accounts" f
  WHERE t."financeAccountId" IS NULL AND f."altegioAccountId" = t."accountId";
UPDATE "bank_accounts" t SET "financeAccountId" = f."id"
  FROM "finance_accounts" f
  WHERE t."financeAccountId" IS NULL AND t."altegioAccountId" ~ '^[0-9]{1,9}$'
    AND f."altegioAccountId" = t."altegioAccountId"::int;

-- Тригери: код оплат і документів не міняємо, власний id ставить БД.
CREATE OR REPLACE FUNCTION kresco_fill_payment_finance_account() RETURNS trigger AS $$
BEGIN
  IF NEW."paymentKind" = 'deposit' THEN
    NEW."financeAccountId" := NULL;
  ELSE
    NEW."financeAccountId" := kresco_ensure_finance_account(NEW."accountId", NEW."accountTitle");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kresco_fill_document_finance_account() RETURNS trigger AS $$
BEGIN
  NEW."financeAccountId" := kresco_ensure_finance_account(NEW."accountId", NEW."accountTitle");
  NEW."counterFinanceAccountId" := kresco_ensure_finance_account(NEW."counterAccountId", NEW."counterAccountTitle");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kresco_fill_count_finance_account() RETURNS trigger AS $$
BEGIN
  NEW."financeAccountId" := kresco_ensure_finance_account(NEW."accountId", NEW."accountTitle");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kresco_fill_bank_finance_account() RETURNS trigger AS $$
BEGIN
  IF NEW."altegioAccountId" ~ '^[0-9]{1,9}$' THEN
    NEW."financeAccountId" := kresco_ensure_finance_account(NEW."altegioAccountId"::int, NEW."altegioAccountTitle");
  ELSE
    NEW."financeAccountId" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "salon_checkout_payments_fill_finance_account" ON "salon_checkout_payments";
CREATE TRIGGER "salon_checkout_payments_fill_finance_account"
  BEFORE INSERT OR UPDATE OF "accountId", "paymentKind" ON "salon_checkout_payments"
  FOR EACH ROW EXECUTE FUNCTION kresco_fill_payment_finance_account();

DROP TRIGGER IF EXISTS "finance_documents_fill_finance_account" ON "finance_documents";
CREATE TRIGGER "finance_documents_fill_finance_account"
  BEFORE INSERT OR UPDATE OF "accountId", "counterAccountId" ON "finance_documents"
  FOR EACH ROW EXECUTE FUNCTION kresco_fill_document_finance_account();

DROP TRIGGER IF EXISTS "cash_till_counts_fill_finance_account" ON "cash_till_counts";
CREATE TRIGGER "cash_till_counts_fill_finance_account"
  BEFORE INSERT OR UPDATE OF "accountId" ON "cash_till_counts"
  FOR EACH ROW EXECUTE FUNCTION kresco_fill_count_finance_account();

DROP TRIGGER IF EXISTS "bank_accounts_fill_finance_account" ON "bank_accounts";
CREATE TRIGGER "bank_accounts_fill_finance_account"
  BEFORE INSERT OR UPDATE OF "altegioAccountId" ON "bank_accounts"
  FOR EACH ROW EXECUTE FUNCTION kresco_fill_bank_finance_account();
