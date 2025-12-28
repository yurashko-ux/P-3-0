# Швидке додавання колонки telegramChatId

## Варіант 1: Через Prisma Studio (найпростіший)

```bash
cd /Users/mykolay/P-3-0/web
npx prisma studio
```

Після відкриття Prisma Studio:
1. Знайдіть таблицю `direct_masters` в списку зліва
2. Натисніть на неї
3. Відкрийте вкладку "Database" або використайте будь-який SQL клієнт

Виконайте SQL:
```sql
ALTER TABLE "direct_masters" ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER;
CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" ON "direct_masters"("telegramChatId");
```

## Варіант 2: Через Vercel Dashboard

1. Перейдіть на https://vercel.com/dashboard
2. Виберіть ваш проект
3. Storage → Postgres → Query
4. Виконайте той самий SQL

## Варіант 3: Через psql (якщо є DATABASE_URL)

```bash
# Отримайте DATABASE_URL з Vercel Environment Variables
psql $DATABASE_URL -c "ALTER TABLE direct_masters ADD COLUMN IF NOT EXISTS telegramChatId INTEGER;"
psql $DATABASE_URL -c "CREATE INDEX IF NOT EXISTS direct_masters_telegramChatId_idx ON direct_masters(telegramChatId);"
```

## Після додавання колонки

1. Перезавантажте сторінку адмін-панелі
2. Список відповідальних має з'явитися
3. Можна додавати Telegram Chat ID для адміністраторів

