-- Касовка зберігає очікувану суму, розбіжність і баланс плитки після проведення.
ALTER TABLE "cash_till_counts" ADD COLUMN "expectedUah" DOUBLE PRECISION;
ALTER TABLE "cash_till_counts" ADD COLUMN "varianceUah" DOUBLE PRECISION;
ALTER TABLE "cash_till_counts" ADD COLUMN "bookUah" DOUBLE PRECISION;
