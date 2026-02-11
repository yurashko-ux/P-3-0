-- Додаємо paidServiceRecordId в DirectClient (nullable) для breakdown тільки по одному запису візиту
ALTER TABLE "DirectClient" ADD COLUMN IF NOT EXISTS "paidServiceRecordId" INTEGER;
