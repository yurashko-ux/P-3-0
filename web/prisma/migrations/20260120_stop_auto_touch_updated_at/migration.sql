-- Не оновлюємо updatedAt автоматично/масово.
-- updatedAt буде рухатись ТІЛЬКИ там, де ми явно ставимо його в коді при “реальній активності”.

ALTER TABLE "direct_clients"
ALTER COLUMN "updatedAt" SET DEFAULT NOW();

