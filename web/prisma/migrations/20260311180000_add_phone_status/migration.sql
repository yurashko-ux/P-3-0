-- Додаємо статус «Телефон» для Binotel-лідів (колір #AF0087)
-- Якщо статус вже існує — пропускаємо (idempotent)
INSERT INTO "direct_statuses" ("id", "name", "color", "order", "isDefault", "createdAt", "updatedAt")
SELECT 'phone', 'Телефон', '#AF0087', 0.25, false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "direct_statuses" WHERE "id" = 'phone');
