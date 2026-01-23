-- Видалення стану "lead" з бази даних
-- Стан "lead" більше не використовується в системі

-- Видалити всі записи зі станом "lead" з історії станів
DELETE FROM "direct_client_state_logs" WHERE "state" = 'lead';

-- Оновити всіх клієнтів зі станом "lead" на "client"
UPDATE "direct_clients" SET "state" = 'client' WHERE "state" = 'lead';
