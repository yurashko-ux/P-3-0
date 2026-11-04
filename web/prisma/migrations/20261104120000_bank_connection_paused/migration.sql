-- Призупинене підключення monobank: вебхук знято, нові платежі й баланси не тягнемо, історія лишається.
ALTER TABLE "bank_connections" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
