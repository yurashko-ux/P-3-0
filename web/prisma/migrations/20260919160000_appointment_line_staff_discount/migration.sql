-- Виконавці на рядках послуг/товарів + знижка/базова ціна для UI як у Altegio

ALTER TABLE "salon_appointment_lines"
  ADD COLUMN IF NOT EXISTS "firstCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "salon_appointment_lines"
  ADD COLUMN IF NOT EXISTS "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "salon_appointment_lines"
  ADD COLUMN IF NOT EXISTS "staffIdsJson" TEXT;

ALTER TABLE "salon_appointment_good_lines"
  ADD COLUMN IF NOT EXISTS "staffIdsJson" TEXT;
