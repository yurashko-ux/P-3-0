-- Додаємо телефон в DirectClient (nullable)
ALTER TABLE "direct_clients"
ADD COLUMN IF NOT EXISTS "phone" TEXT;

