-- Посилання на повідомлення payment-бота для автоматичного видалення після зведення.
ALTER TABLE "bank_altegio_payment_matches"
  ADD COLUMN "telegram_outgoing_messages" JSONB,
  ADD COLUMN "telegram_messages_deleted_at" TIMESTAMP(3);
