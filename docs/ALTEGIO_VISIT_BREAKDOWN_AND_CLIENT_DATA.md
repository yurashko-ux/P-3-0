# Як ми отримуємо дані по клієнтах, послугах та товарах з Altegio

Цей документ описує механізм отримання даних з **API Altegio** для відображення сум візитів та розбиття по майстрах у Direct Manager. **Джерело даних — тільки API Altegio** (ніяких даних з KV для breakdown/sums).

Якщо щось зламається з сумами візитів або розбиттям по майстрах — перевір цю інструкцію та код у `web/lib/altegio/visits.ts`.

---

## 1. Загальний принцип

- **Сума візиту** = сума **послуг та товарів** (items) по одному запису (record) візиту.
- **Не рахуємо** платежі (`payment_transactions`) — інакше виходить подвійний підрахунок (наприклад, 14 тис. замість 7,1 тис.).
- Якщо є **recordId** (запис у візиті) — рахуємо тільки цей запис. Якщо немає — рахуємо по всьому візиту (всі records).

---

## 2. Джерело даних

| Що потрібно | Джерело | Примітка |
|-------------|---------|----------|
| Список записів у візиті, location_id, імена майстрів | **GET /visits/{visit_id}** | Відповідь: `data` або сам об'єкт; `records` (або `visit_records` / `appointments` / `items`); `location_id` (або `company_id` / `locationId` / `salon_id`) |
| Послуги та товари по запису | **GET /visit/details/{companyId}/{recordId}/{visitId}** | Беремо **тільки** `items` (або `visit_items` / `services`). **Не** використовуємо `payment_transactions` та не підставляємо `data.transactions` як items |
| recordId для клієнта | Вебхук Altegio (resource=record): `body.resource_id` | Зберігаємо в БД як `paidServiceRecordId` |

**KV не використовується** для розрахунку сум та breakdown — тільки API.

---

## 3. Потік даних (код)

### 3.1. Нормалізація відповіді API

API Altegio може повертати різні обгортки та назви полів. У `web/lib/altegio/visits.ts` використовуються допоміжні функції:

- **Відповідь загалом:** `response.data ?? response` (нормалізація обгортки).
- **Масив записів візиту:** `data.records ?? data.visit_records ?? data.appointments ?? data.items`.
- **Локація:** `data.location_id ?? data.company_id ?? data.locationId ?? data.salon_id`.
- **ID запису в record:** `rec.id ?? rec.record_id`.
- **Масив items (послуги/товари):** `data.items ?? data.visit_items ?? data.services`. **Без** `data.transactions`, щоб не плутати з платежами.
- **Поля в item:** вартість — `cost ?? price ?? sum ?? total`; кількість — `amount ?? quantity ?? count ?? 1`; майстер — `master_id ?? masterId ?? staff_id ?? staffId`.

### 3.2. Розрахунок breakdown (fetchVisitBreakdownFromAPI)

1. Виклик **GET /visits/{visitId}** → отримуємо `records`, `locationId`, будуємо мапу `masterId → name` з `records[].staff` (title/name).
2. Якщо передано **onlyRecordId** — фільтруємо `records` до одного запису з цим id.
3. Для кожного запису з `recordsToProcess`:
   - Виклик **GET /visit/details/{locationId}/{recordId}/{visitId}**.
   - Беремо тільки **items** (`getItemsFromDetailsData` — без `payment_transactions` і без `data.transactions`).
   - Для кожного item: `sum = cost × amount`, групуємо по `master_id`, дедуплікація по `item.id` або по ключу master+title+cost+amount.
4. **Платежі не додаємо** — не використовуємо `payment_transactions`, щоб уникнути подвоєння суми.

Результат: масив `{ masterName, sumUAH }[]` — сума послуг і товарів по майстрах для одного запису або всього візиту.

### 3.3. Де викликається

| Місце | Коли | recordId |
|-------|------|----------|
| **Вебхук Altegio** (`web/app/api/altegio/webhook/route.ts`) | Подія record (create/update), є visitId та altegioClientId | Так — з `body.resource_id` |
| **GET /api/admin/direct/clients** (fallback) | У клієнта є paidServiceVisitId, але немає breakdown або він порожній | Якщо є — з `paidServiceRecordId` |
| **Backfill** (кнопка «Оновити суми по майстрах») — POST /api/admin/direct/backfill-visit-breakdown | Ручне оновлення breakdown для клієнтів з paidServiceDate | Наразі не передається (береться весь візит) |

### 3.4. Що зберігається в БД (DirectClient)

- `paidServiceVisitId` — id візиту в Altegio.
- `paidServiceRecordId` — id запису в цьому візиті (якщо є; з вебхука).
- `paidServiceVisitBreakdown` — масив `{ masterName, sumUAH }[]`.
- `paidServiceTotalCost` — сума breakdown (послуги + товари, без платежів).

---

## 4. Типові помилки та перевірки

- **Подвійний підрахунок (наприклад, 14 тис. замість 7 тис.):** переконатися, що в суму **не** входять `payment_transactions` і що в items **не** підставляється `data.transactions`.
- **Невірна сума по всьому візиту замість одного запису:** переконатися, що при наявності `recordId` (з вебхука або з `paidServiceRecordId`) у `fetchVisitBreakdownFromAPI` передається третій аргумент `onlyRecordId`.
- **API повертає інші ключі:** перевірити нормалізацію в `getItemsFromDetailsData`, `getRecordsFromVisitData`, `getLocationIdFromVisitData` та геттери для item (cost, amount, master_id) — додати потрібні варіанти назв полів.

---

## 5. Файли

- **Логіка breakdown та запити до API:** `web/lib/altegio/visits.ts` — `getVisitWithRecords`, `getVisitDetails`, `fetchVisitBreakdownFromAPI`, допоміжні функції нормалізації.
- **HTTP-клієнт Altegio:** `web/lib/altegio/client.ts` — `altegioFetch`.
- **Збереження після вебхука:** `web/app/api/altegio/webhook/route.ts` (блок з `fetchVisitBreakdownFromAPI` та `paidServiceRecordId`).
- **Fallback при завантаженні клієнтів:** `web/app/api/admin/direct/clients/route.ts` (блок needFallback з `fetchVisitBreakdownFromAPI`).
- **Кнопка «Оновити суми по майстрах»:** викликає `POST /api/admin/direct/backfill-visit-breakdown`.
