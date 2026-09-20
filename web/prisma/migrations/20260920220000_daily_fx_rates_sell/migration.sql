-- Перехід на Monobank rateSell + робочий = ceil(sell)+1.
-- Очищаємо старі рядки (були rateBuy → round+1), щоб день перезафіксувався з sell.

TRUNCATE TABLE "daily_fx_rates";

ALTER TABLE "daily_fx_rates" RENAME COLUMN "usdBuy" TO "usdSell";
ALTER TABLE "daily_fx_rates" RENAME COLUMN "eurBuy" TO "eurSell";
