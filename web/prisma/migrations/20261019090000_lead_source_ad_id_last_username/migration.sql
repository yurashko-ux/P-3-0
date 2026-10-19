-- Instagram-юзернейм останньої людини, яка прийшла з цього ad_id (орієнтир в UI "Оголошення Meta").
ALTER TABLE "lead_source_ad_ids" ADD COLUMN IF NOT EXISTS "lastUsername" TEXT;
