-- Термінал тепер визначається за банківським платежем РКО, а не за розкладом.

ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "automaticTerminalFeeEnabled";
ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "automaticTerminalFeeKopiykas";
ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "automaticTerminalFeeDayOfMonth";
