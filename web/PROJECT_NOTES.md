# P-3-0 Автоматизація: робочі нотатки

## Технічне завдання
- Отримувати вхідні повідомлення з ManyChat (Instagram DM) через webhook `POST /api/mc/manychat`.
- Визначати активну кампанію на основі значень V1/V2 (ключових слів), заданих у кампаніях.
- Для кампанії шукати картку клієнта у KeyCRM за `contact.social_id` або `full_name` у базовій парі (воронка + статус).
- Автоматично переміщати знайдену картку у цільову пару (воронка + статус), визначену в кампанії.
- Надавати в адмінці тестову сторінку з повною діагностикою (вебхуки, кампанії, пошук карток, переміщення).

## Поточна архітектура
### ManyChat
- Webhook: `web/app/api/mc/manychat/route.ts` — парсить запити, зберігає останній payload, запускає `routeManychatMessage`, повертає діагностику.
- Збереження стану: `web/lib/manychat-store.ts` — ключі Vercel KV (`manychat:last-message`, `manychat:last-feed`, `manychat:last-automation`, `manychat:last-request`, `manychat:last-raw`).
- Автоматизація: `web/lib/manychat-routing.ts` — нормалізація повідомлень, добір кампаній, підготовка пошуку та переміщення, формування діагностики.
- Тестова сторінка: `web/app/admin/debug/page.tsx` + компоненти `web/components/admin/manychat-message-inbox.tsx` та `manychat-campaign-router.tsx` — візуалізація вебхуків, таймлайн автоматизації, ручні запуски.

### Кампанії
- API: `web/app/api/campaigns/route.ts` — CRUD у Vercel KV, нормалізація правил V1/V2, кешування.
- Сторінки: `web/app/(admin)/admin/campaigns` — список, створення, редагування (форма з підбором pipeline/status + pipeline_status_id).
- Дані зберігаються в KV (`campaigns:items`, `campaigns:index` тощо) у JSON із базовою та цільовою парами, у правилах фіксується `pipeline_status_id`.

### KeyCRM
- Конфіг: `web/lib/env.ts` (`KEYCRM_BASE_URL`, `KEYCRM_API_URL`, токени).
- Воронки та статуси: `web/lib/keycrm-pipelines.ts` — гібридний кеш, кілька ендпоінтів для отримання статусів, включно з `pipeline_status_id`.
- Пошук карток: `web/lib/keycrm-card-search.ts` + `web/app/api/keycrm/card/find/route.ts` — JSON:API-фільтри, fallback на детальний перегляд.
- Переміщення: `web/lib/keycrm-move.ts` + `web/app/api/keycrm/card/move/route.ts` — кілька ендпоінтів (`/pipelines/cards/move`, `/cards/{id}/move`, `PUT/PATCH /pipelines/cards/{id}`, `PATCH /crm/deals/{id}`), перевірка переміщення з повторними читаннями.

## Що вже працює
- Повний цикл ManyChat → кампанія → пошук картки → запити переміщення (з детальною діагностикою) запускається автоматично і з тестової сторінки.
- Вебхуки з ManyChat надійно потрапляють у KV; у тестовій адмінці відображаються сирі payload’и, останні повідомлення, журнал, конфіг KV.
- Кампанії зберігають `pipeline_status_id` та друковані назви; адмінка дозволяє створювати/редагувати кампанії через довідники KeyCRM.
- Пошук карток у KeyCRM працює за JSON:API-фільтрами та fallback’ами, показує усі переглянуті картки та збіги.
- Ручний тестовий переміщувач (на тестовій сторінці) успішно переміщує картки за заданими pipeline/status.

## На чому зупинилися
- Автоматичне переміщення карток під час ManyChat-автоматизації завершується `keycrm_move_failed`: KeyCRM приймає запити, але після 20 перевірок картка залишається в базовому статусі.
- Потрібно звірити, які саме `pipeline_status_id`/`status_id` ідуть у фінальний запит з автоматизації, та порівняти з ручним віджетом (який працює через прямий виклик `moveKeycrmCard`).
- Підозра: у кампанії збережено коректні `pipeline_status_id`, але автоматизація все ще відправляє інший набір alias’ів або неправильний payload.
- Наступний крок: порівняти payload/response з тестового віджета і ManyChat-автоматизації, уніфікувати побудову запиту в `routeManychatMessage` з тією, що використовує ручний тест.

## Корисні посилання та маршрути
- ManyChat webhook: `POST /api/mc/manychat`.
- Тестова ManyChat-сторінка: `/admin/debug` → «ManyChat інтеграція».
- Кампанії: `/admin/campaigns`, `POST /api/campaigns`.
- Пошук карток: `GET /api/keycrm/card/find`.
- Переміщення (ручне/автоматичне): `POST /api/keycrm/card/move`.

## Конфігурація середовища
- ManyChat: `MC_TOKEN` (для webhook), `MANYCHAT_API_KEY` (REST, нині вимкнено), `MANYCHAT_INBOX_LIMIT` (опційно).
- KeyCRM: `KEYCRM_BASE_URL` або `KEYCRM_API_URL`, `KEYCRM_API_TOKEN` (bearer), за потреби читальні токени.
- Vercel KV: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`.

## Примітки для продовження
- Зберегти лог останнього невдалого переміщення з таймлайна (payload + history) для порівняння.
- Переконатися, що автоматизація передає ті самі заголовки (авторизація, protection bypass), що й ручні запити.
- Після виправлення — протестувати повний цикл на новій кампанії (із унікальним V1/V2) і підтвердити, що картка змінює статус у KeyCRM.

## Швидкий старт у новому чаті
1. Розгорни репозиторій `P-3-0`, перейдіть у директорію `web`.
2. Перевір змінні середовища (особливо `KEYCRM_*`, `KV_*`, `MC_*`). Без них автоматизація повністю не працює.
3. Проглянь `/admin/debug` — блок ManyChat показує останній webhook, знайдену кампанію, картку та історію переміщення.
4. Якщо потрібно вручну відтворити переміщення, скористайся виджетом пошуку/переміщення на тій же сторінці, щоб зафіксувати payload, який точно працює.
5. Далі внеси зміни у `web/lib/manychat-routing.ts` або `web/lib/keycrm-move.ts`, аби автоматизація використовувала той самий payload, і повторно перевір таймлайн.
