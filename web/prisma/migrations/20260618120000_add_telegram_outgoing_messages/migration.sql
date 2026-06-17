-- Посилання на повідомлення payment-бота для автоматичного видалення після зведення.
ALTER TABLE "bank_altegio_payment_matches"
  ADD COLUMN IF NOT EXISTS "telegram_outgoing_messages" JSONB,
  ADD COLUMN IF NOT EXISTS "telegram_messages_deleted_at" TIMESTAMP(3);
