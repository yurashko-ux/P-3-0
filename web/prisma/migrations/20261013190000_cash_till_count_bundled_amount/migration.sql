-- Порахована (скріплена) готівка в касовці окремо від перерахунку купюр.
ALTER TABLE "cash_till_counts" ADD COLUMN "bundledAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
