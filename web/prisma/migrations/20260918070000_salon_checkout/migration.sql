-- Каса MVP: чек закриття візиту (послуги + оплата)

CREATE TABLE IF NOT EXISTS "salon_checkouts" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "altegioRecordId" INTEGER,
    "altegioVisitId" INTEGER,
    "totalServices" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "syncError" TEXT,
    "source" TEXT NOT NULL DEFAULT 'kresco',
    "kyivDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salon_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salon_checkouts_appointmentId_key" ON "salon_checkouts"("appointmentId");
CREATE INDEX IF NOT EXISTS "salon_checkouts_altegioRecordId_idx" ON "salon_checkouts"("altegioRecordId");
CREATE INDEX IF NOT EXISTS "salon_checkouts_status_idx" ON "salon_checkouts"("status");
CREATE INDEX IF NOT EXISTS "salon_checkouts_kyivDay_idx" ON "salon_checkouts"("kyivDay");
CREATE INDEX IF NOT EXISTS "salon_checkouts_source_idx" ON "salon_checkouts"("source");

CREATE TABLE IF NOT EXISTS "salon_checkout_payments" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "accountTitle" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "altegioTransactionId" INTEGER,

    CONSTRAINT "salon_checkout_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "salon_checkout_payments_checkoutId_idx" ON "salon_checkout_payments"("checkoutId");
CREATE INDEX IF NOT EXISTS "salon_checkout_payments_accountId_idx" ON "salon_checkout_payments"("accountId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_checkouts_appointmentId_fkey'
  ) THEN
    ALTER TABLE "salon_checkouts"
      ADD CONSTRAINT "salon_checkouts_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "salon_appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'salon_checkout_payments_checkoutId_fkey'
  ) THEN
    ALTER TABLE "salon_checkout_payments"
      ADD CONSTRAINT "salon_checkout_payments_checkoutId_fkey"
      FOREIGN KEY ("checkoutId") REFERENCES "salon_checkouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
