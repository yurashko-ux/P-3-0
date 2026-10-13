-- Час останнього оновлення поточного балансу Monobank.
ALTER TABLE "bank_accounts" ADD COLUMN "balanceUpdatedAt" TIMESTAMP(3);
