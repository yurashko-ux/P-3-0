-- Продаж волосся: ціна закупівлі в $ і робочий курс дня продажу фіксуються в рядку чека.
ALTER TABLE "salon_checkout_good_lines" ADD COLUMN IF NOT EXISTS "costUsd" DOUBLE PRECISION;
ALTER TABLE "salon_checkout_good_lines" ADD COLUMN IF NOT EXISTS "fxRateUsdUah" DOUBLE PRECISION;
