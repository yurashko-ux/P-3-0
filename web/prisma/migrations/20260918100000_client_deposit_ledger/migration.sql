-- Етап 5: нативний ledger завдатки + paymentKind на платежі чека

ALTER TABLE "salon_checkout_payments" ADD COLUMN IF NOT EXISTS "paymentKind" TEXT NOT NULL DEFAULT 'account';
ALTER TABLE "salon_checkout_payments" ADD COLUMN IF NOT EXISTS "depositAccountId" TEXT;

CREATE INDEX IF NOT EXISTS "salon_checkout_payments_paymentKind_idx" ON "salon_checkout_payments"("paymentKind");
CREATE INDEX IF NOT EXISTS "salon_checkout_payments_depositAccountId_idx" ON "salon_checkout_payments"("depositAccountId");

CREATE TABLE IF NOT EXISTS "client_deposit_accounts" (
    "id" TEXT NOT NULL,
    "directClientId" TEXT,
    "altegioClientId" INTEGER,
    "altegioDepositId" INTEGER,
    "title" TEXT NOT NULL DEFAULT 'Особистий рахунок',
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'altegio_import',
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_deposit_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_deposit_accounts_altegioDepositId_key" ON "client_deposit_accounts"("altegioDepositId");
CREATE INDEX IF NOT EXISTS "client_deposit_accounts_directClientId_idx" ON "client_deposit_accounts"("directClientId");
CREATE INDEX IF NOT EXISTS "client_deposit_accounts_altegioClientId_idx" ON "client_deposit_accounts"("altegioClientId");
CREATE INDEX IF NOT EXISTS "client_deposit_accounts_isActive_idx" ON "client_deposit_accounts"("isActive");
CREATE INDEX IF NOT EXISTS "client_deposit_accounts_syncStatus_idx" ON "client_deposit_accounts"("syncStatus");

CREATE TABLE IF NOT EXISTS "client_deposit_ledger_entries" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "salonAppointmentId" TEXT,
    "salonCheckoutId" TEXT,
    "altegioDocumentId" INTEGER,
    "altegioDepositTxId" INTEGER,
    "altegioPaymentTxId" INTEGER,
    "kyivDay" TEXT NOT NULL,
    "comment" TEXT,
    "createdBy" TEXT,
    "source" TEXT NOT NULL DEFAULT 'kresco',
    "syncStatus" TEXT NOT NULL DEFAULT 'synced',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_deposit_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "client_deposit_ledger_entries_altegioDepositTxId_key" ON "client_deposit_ledger_entries"("altegioDepositTxId");
CREATE INDEX IF NOT EXISTS "client_deposit_ledger_entries_accountId_idx" ON "client_deposit_ledger_entries"("accountId");
CREATE INDEX IF NOT EXISTS "client_deposit_ledger_entries_kind_idx" ON "client_deposit_ledger_entries"("kind");
CREATE INDEX IF NOT EXISTS "client_deposit_ledger_entries_kyivDay_idx" ON "client_deposit_ledger_entries"("kyivDay");
CREATE INDEX IF NOT EXISTS "client_deposit_ledger_entries_salonAppointmentId_idx" ON "client_deposit_ledger_entries"("salonAppointmentId");
CREATE INDEX IF NOT EXISTS "client_deposit_ledger_entries_salonCheckoutId_idx" ON "client_deposit_ledger_entries"("salonCheckoutId");
CREATE INDEX IF NOT EXISTS "client_deposit_ledger_entries_source_idx" ON "client_deposit_ledger_entries"("source");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_deposit_accounts_directClientId_fkey'
  ) THEN
    ALTER TABLE "client_deposit_accounts"
      ADD CONSTRAINT "client_deposit_accounts_directClientId_fkey"
      FOREIGN KEY ("directClientId") REFERENCES "direct_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_deposit_ledger_entries_accountId_fkey'
  ) THEN
    ALTER TABLE "client_deposit_ledger_entries"
      ADD CONSTRAINT "client_deposit_ledger_entries_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "client_deposit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_deposit_ledger_entries_salonAppointmentId_fkey'
  ) THEN
    ALTER TABLE "client_deposit_ledger_entries"
      ADD CONSTRAINT "client_deposit_ledger_entries_salonAppointmentId_fkey"
      FOREIGN KEY ("salonAppointmentId") REFERENCES "salon_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_deposit_ledger_entries_salonCheckoutId_fkey'
  ) THEN
    ALTER TABLE "client_deposit_ledger_entries"
      ADD CONSTRAINT "client_deposit_ledger_entries_salonCheckoutId_fkey"
      FOREIGN KEY ("salonCheckoutId") REFERENCES "salon_checkouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_checkout_payments_depositAccountId_fkey'
  ) THEN
    ALTER TABLE "salon_checkout_payments"
      ADD CONSTRAINT "salon_checkout_payments_depositAccountId_fkey"
      FOREIGN KEY ("depositAccountId") REFERENCES "client_deposit_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
