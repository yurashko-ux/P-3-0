# Monobank API та Webhook в проєкті P-3-0

Документ описує, як у нас налаштовані інтеграція Monobank, вебхуки, діагностика, та що перевіряти при збоях.

## 1) Де це в адмінці

- Сторінка підключень банку: `https://p-3-0.vercel.app/admin/bank/connections`
- Таблиця операцій банку: `https://p-3-0.vercel.app/admin/bank`

**Еквайринг (окремо від Personal):** повна інструкція — репозиторій `docs/BANK_MONOBANK_ACQUIRING.md` (що зроблено, токени, порожня виписка, endpoint `/api/bank/acquiring/statement`).

## 2) Ключовий принцип для webhook URL

Webhook для Monobank у проєкті **завжди** реєструється на production-домен:

- `https://p-3-0.vercel.app/api/bank/monobank/webhook`

Це зроблено спеціально, щоб уникати проблем preview-деплоїв Vercel (cold start/повільна валідація).

## 3) Які API endpoint-и використовуємо

### Endpoint-и нашого проєкту (admin)

- Підключення Monobank: `POST https://p-3-0.vercel.app/api/bank/monobank/connect`
- Повторна реєстрація webhook: `POST https://p-3-0.vercel.app/api/bank/monobank/reregister-webhook`
- Вимкнути webhook: `POST https://p-3-0.vercel.app/api/bank/monobank/delete-webhook`
- Статус webhook (що збережено в Monobank): `GET https://p-3-0.vercel.app/api/bank/monobank/webhook/status?connectionId=<ID>`
- Лог останніх webhook-подій: `GET https://p-3-0.vercel.app/api/bank/monobank/webhook/log`
- Примусова синхронізація виписки: `POST https://p-3-0.vercel.app/api/bank/statement/sync`
- Отримання виписки з БД: `GET https://p-3-0.vercel.app/api/bank/statement?accountId=<ID>&from=YYYY-MM-DD&to=YYYY-MM-DD`
- Операції для таблиці Банк: `GET https://p-3-0.vercel.app/api/bank/operations?from=YYYY-MM-DD&to=YYYY-MM-DD&direction=all`
- Виписка еквайрингу (діагностика, UI на сторінці підключень): `GET https://p-3-0.vercel.app/api/bank/acquiring/statement` — деталі в `docs/BANK_MONOBANK_ACQUIRING.md`

### Endpoint Monobank (з нашого backend)

- `GET https://api.monobank.ua/personal/client-info`
- `POST https://api.monobank.ua/personal/webhook`
- `GET https://api.monobank.ua/personal/webhook`
- `DELETE https://api.monobank.ua/personal/webhook`
- `GET https://api.monobank.ua/personal/statement/{account}/{from}/{to}`
- Еквайринг (при наявності відповідного токена): `GET https://api.monobank.ua/api/merchant/statement?from=&to=`

## 4) Як працює реєстрація webhook у нас

### При первинному підключенні (`/api/bank/monobank/connect`)

1. Беремо token Monobank.
2. Отримуємо `client-info` (рахунки, ім'я клієнта).
3. Реєструємо webhook на `https://p-3-0.vercel.app/api/bank/monobank/webhook`.
4. Зберігаємо `bankConnection` та `bankAccount`.

### При повторній реєстрації (`/api/bank/monobank/reregister-webhook`)

1. Робимо попередній GET на наш webhook URL (розігрів endpoint).
2. Викликаємо `setWebhook` в Monobank.
3. Чекаємо ~3 секунди.
4. Перевіряємо фактично збережений URL:
   - спочатку через `GET /personal/webhook`;
   - якщо порожньо, fallback через `client-info.webHookUrl`.

## 5) Валідація Monobank GET і чому це важливо

Monobank при встановленні webhook надсилає GET-запит на URL і очікує швидку відповідь `200`.

Щоб уникнути проблем із cold start:

- у `web/middleware.ts` додано матч для `/api/bank/monobank/webhook`;
- якщо це `GET /api/bank/monobank/webhook`, middleware одразу повертає `200` на Edge.

Це підвищує шанс успішної валідації webhook.

## 6) Що зберігаємо по транзакціях

Модель `BankStatementItem` зберігає, зокрема:

- `description`
- `comment` (призначення платежу)
- `counterName` (контрагент)
- `amount`, `balance`, `mcc`, `operationAmount`, інші технічні поля

Заповнення відбувається в обох потоках:

- через webhook (`/api/bank/monobank/webhook`);
- через ручну синхронізацію (`/api/bank/statement/sync`).

## 7) Що показує UI

На сторінці `https://p-3-0.vercel.app/admin/bank` в таблиці операцій відображаємо:

- Опис (`description`)
- Призначення (`comment`)
- Контрагент (`counterName`)

Якщо поле відсутнє в Monobank для конкретної операції, показуємо `—`.

## 8) Rate limit-и та обмеження Monobank

- `client-info`: не частіше 1 разу на 60 сек.
- `statement`: не частіше 1 разу на 60 сек на рахунок; максимум 500 операцій за запит.
- Якщо 500 операцій, використовуємо пагінацію до повного отримання періоду.
- Для sync у нас також є внутрішній захист через KV (`RATE_LIMIT_SEC = 60`).

## 9) Діагностика: якщо webhook "не приходить"

1. Відкрити `https://p-3-0.vercel.app/admin/bank/connections`.
2. Для потрібного підключення натиснути:
   - `Що збережено` (переконатися, що URL збігається);
   - `Повторно зареєструвати` (якщо порожньо/не збігається).
3. Зробити реальну операцію по картці (оплата/переказ/поповнення).
4. Натиснути `Останні вебхуки` і перевірити події.
5. Якщо подій немає, натиснути `Підтягнути з API` по рахунку, щоб дані підтягнулися через statement API.

## 10) Типові причини проблем

- Реєстрація виконувалася не з production-середовища (вже виправлено, URL зафіксовано на production).
- Monobank тимчасово не зберіг URL одразу після `setWebhook` (враховано паузою + fallback перевіркою).
- Ліміт Monobank 1/60с (отримаєте 429 або порожній/застарілий стан у короткий момент).
- В webhook події приходять по `account externalId`, якого немає в БД (лог у webhook route це показує).

## 11) Важливі файли реалізації

- `web/app/api/bank/monobank/connect/route.ts`
- `web/app/api/bank/monobank/reregister-webhook/route.ts`
- `web/app/api/bank/monobank/webhook/status/route.ts`
- `web/app/api/bank/monobank/webhook/route.ts`
- `web/app/api/bank/statement/sync/route.ts`
- `web/app/api/bank/operations/route.ts`
- `web/middleware.ts`
- `web/lib/bank/monobank.ts`
- `web/prisma/schema.prisma`
