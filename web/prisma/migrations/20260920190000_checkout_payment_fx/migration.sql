-- Платіж каси: сума в валюті рахунку (напр. $) + курс на момент оплати
ALTER TABLE "salon_checkout_payments"
  ADD COLUMN IF NOT EXISTS "amountFx" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "currencyCode" TEXT,
  ADD COLUMN IF NOT EXISTS "fxRate" DOUBLE PRECISION;
