-- Посилання на повідомлення payment-бота для автоматичного видалення після зведення.
ALTER TABLE "bank_altegio_payment_matches"
  ADD COLUMN IF NOT EXISTS "telegramOutgoingMessages" JSONB,
  ADD COLUMN IF NOT EXISTS "telegramMessagesDeletedAt" TIMESTAMP(3);
