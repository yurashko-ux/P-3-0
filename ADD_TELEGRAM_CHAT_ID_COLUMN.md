# Інструкція: Додавання колонки telegramChatId до таблиці direct_masters

## Варіант 1: Через Prisma Studio (найпростіший спосіб)

### Крок 1: Встановіть Prisma Studio локально
```bash
cd /Users/mykolay/P-3-0/web
npx prisma studio
```

### Крок 2: Відкрийте Prisma Studio
- Prisma Studio відкриється в браузері за адресою `http://localhost:5555`
- Або використайте команду з повним URL, якщо потрібно

### Крок 3: Виконайте SQL запит
1. Відкрийте вкладку "Database" або "SQL" (якщо доступна)
2. Або використайте будь-який SQL клієнт з підключенням до вашої бази даних
3. Виконайте наступний SQL запит:

```sql
ALTER TABLE "direct_masters" 
ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER;

CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" 
ON "direct_masters"("telegramChatId");
```

---

## Варіант 2: Через Vercel Postgres Dashboard

### Крок 1: Відкрийте Vercel Dashboard
1. Перейдіть на https://vercel.com/dashboard
2. Виберіть ваш проект
3. Перейдіть в розділ "Storage" або "Database"

### Крок 2: Відкрийте Postgres Database
1. Знайдіть вашу Postgres базу даних
2. Натисніть на неї
3. Перейдіть в розділ "Query" або "SQL Editor"

### Крок 3: Виконайте SQL запит
Вставте та виконайте наступний SQL:

```sql
ALTER TABLE "direct_masters" 
ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER;

CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" 
ON "direct_masters"("telegramChatId");
```

---

## Варіант 3: Через psql (командний рядок)

### Крок 1: Отримайте DATABASE_URL
```bash
# Перевірте ваш DATABASE_URL в Vercel Environment Variables
# Або використайте PRISMA_DATABASE_URL
```

### Крок 2: Підключіться до бази даних
```bash
# Якщо використовуєте Prisma connection string:
psql "postgresql://user:password@host:port/database?schema=public"

# Або якщо у вас є DATABASE_URL в env:
psql $DATABASE_URL
```

### Крок 3: Виконайте SQL запит
```sql
ALTER TABLE "direct_masters" 
ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER;

CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" 
ON "direct_masters"("telegramChatId");

-- Перевірте результат:
\d direct_masters
```

---

## Варіант 4: Через Prisma Migrate (рекомендовано)

### Крок 1: Створіть міграцію локально
```bash
cd /Users/mykolay/P-3-0/web
npx prisma migrate dev --name add_telegram_chat_id --create-only
```

### Крок 2: Відредагуйте файл міграції
Відкрийте створений файл міграції в `prisma/migrations/XXXXXX_add_telegram_chat_id/migration.sql` і додайте:

```sql
-- AlterTable
ALTER TABLE "direct_masters" ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" ON "direct_masters"("telegramChatId");
```

### Крок 3: Застосуйте міграцію
```bash
# Локально (для тесту):
npx prisma migrate dev

# На production (Vercel):
npx prisma migrate deploy
```

---

## Варіант 5: Через будь-який SQL клієнт (DBeaver, pgAdmin, TablePlus, тощо)

### Крок 1: Підключіться до бази даних
Використайте ваш `DATABASE_URL` або `PRISMA_DATABASE_URL` з Vercel Environment Variables.

**Формат підключення:**
```
Host: [host з DATABASE_URL]
Port: [port з DATABASE_URL, зазвичай 5432]
Database: [database name]
User: [username]
Password: [password]
```

### Крок 2: Відкрийте SQL Editor
1. Виберіть вашу базу даних
2. Відкрийте SQL Editor / Query Editor
3. Вставте та виконайте SQL:

```sql
ALTER TABLE "direct_masters" 
ADD COLUMN IF NOT EXISTS "telegramChatId" INTEGER;

CREATE INDEX IF NOT EXISTS "direct_masters_telegramChatId_idx" 
ON "direct_masters"("telegramChatId");
```

### Крок 3: Перевірте результат
```sql
-- Перевірте, чи колонка додана:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'direct_masters' 
AND column_name = 'telegramChatId';

-- Перевірте індекс:
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'direct_masters' 
AND indexname = 'direct_masters_telegramChatId_idx';
```

---

## Перевірка після додавання колонки

### Через SQL:
```sql
-- Перевірка структури таблиці:
\d direct_masters

-- Або:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'direct_masters'
ORDER BY ordinal_position;
```

### Через код:
Після додавання колонки, перезавантажте сторінку адмін-панелі - список відповідальних має з'явитися.

---

## Якщо виникають проблеми

### Помилка "permission denied"
Якщо ви отримуєте помилку про права доступу, перевірте:

1. **Чи ви підключені як правильний користувач?**
   ```sql
   SELECT current_user;
   ```

2. **Чи ви власник таблиці?**
   ```sql
   SELECT tableowner 
   FROM pg_tables 
   WHERE tablename = 'direct_masters';
   ```

3. **Якщо ні, надайте права:**
   ```sql
   -- Якщо ви суперкористувач:
   ALTER TABLE "direct_masters" OWNER TO ваш_користувач;
   
   -- Або надайте права:
   GRANT ALL ON TABLE "direct_masters" TO ваш_користувач;
   ```

### Помилка "column already exists"
Якщо колонка вже існує, це нормально - запит `IF NOT EXISTS` не викличе помилку.

---

## Швидкий спосіб (якщо є доступ до Vercel CLI)

```bash
# Встановіть Vercel CLI (якщо ще не встановлено):
npm i -g vercel

# Підключіться до проекту:
vercel link

# Отримайте DATABASE_URL:
vercel env pull

# Виконайте SQL через psql:
psql $DATABASE_URL -c "ALTER TABLE direct_masters ADD COLUMN IF NOT EXISTS telegramChatId INTEGER;"
psql $DATABASE_URL -c "CREATE INDEX IF NOT EXISTS direct_masters_telegramChatId_idx ON direct_masters(telegramChatId);"
```

---

## Після успішного додавання колонки

1. Перезавантажте сторінку адмін-панелі
2. Список відповідальних має з'явитися
3. Можна буде додавати Telegram Chat ID для адміністраторів

---

**Примітка:** Якщо ви використовуєте Prisma на Vercel, найпростіший спосіб - це **Варіант 2 (Vercel Postgres Dashboard)** або **Варіант 4 (Prisma Migrate)**.

