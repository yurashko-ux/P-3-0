-- Оборот з початку місяця на дату відліку (надходження, копійки) + опційний річний ліміт обороту для ФОП
ALTER TABLE "bank_accounts"
ADD COLUMN IF NOT EXISTS "altegioMonthlyTurnoverManual" BIGINT,
ADD COLUMN IF NOT EXISTS "fopAnnualTurnoverLimitKop" BIGINT;
