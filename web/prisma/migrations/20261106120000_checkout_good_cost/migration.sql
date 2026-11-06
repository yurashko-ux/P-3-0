-- Собівартість проданого товару на момент продажу. Наявні рядки лишаються порожніми до донаповнення.
ALTER TABLE "salon_checkout_good_lines" ADD COLUMN IF NOT EXISTS "costPerUnit" DOUBLE PRECISION;
