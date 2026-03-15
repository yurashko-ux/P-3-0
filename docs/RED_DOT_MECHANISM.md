# Механізм червоної крапочки в Direct Manager

Червона крапочка показує, **що змінилось** у клієнта (тригер активності). Відображається тільки в режимі сортування «За активністю» (sortBy=updatedAt) і тільки для клієнтів з активністю сьогодні.

## 1. Джерело даних

### lastActivityKeys і lastActivityAt

У БД (поле `lastActivityKeys`):

- Масив рядків — які поля змінились при останньому оновленні
- Оновлюється при збереженні клієнта (вебхуки Altegio, sync, ручні зміни)

### Як формуються ключі (computeActivityKeys)

[`web/lib/direct-store.ts`](web/lib/direct-store.ts) — функція `computeActivityKeys(prev, finalState)` всередині `saveDirectClient`:

Порівнює попередній стан (з БД) із новим і додає в масив ключів ті поля, що змінились:

| Поле | Ключ в lastActivityKeys |
|------|-------------------------|
| lastMessageAt | `message` |
| paidServiceDate | `paidServiceDate` |
| paidServiceRecordCreatedAt | `paidServiceRecordCreatedAt` |
| paidServiceAttended | `paidServiceAttended` |
| paidServiceCancelled | `paidServiceCancelled` |
| paidServiceTotalCost | `paidServiceTotalCost` |
| consultationBookingDate | `consultationBookingDate` |
| consultationRecordCreatedAt | `consultationRecordCreatedAt` |
| consultationAttended | `consultationAttended` |
| consultationAttendanceValue | `consultationAttended` |
| consultationCancelled | `consultationCancelled` |
| statusId | `statusId` |
| chatStatusId | `chatStatusId` |

Важливо: у `computeActivityKeys` враховуються тільки поля, явно передані в обʼєкті клієнта (не `undefined`).

### Шляхи оновлення lastActivityKeys

- `saveDirectClient` — обчислює через `computeActivityKeys`
- `sync-consultation-for-client` — встановлює `lastActivityKeys: ['consultationAttended']` або `['consultationCancelled']` напряму
- Altegio webhook (консультація) — при attendance 1/2 навіть для **майбутньої дати** візиту оновлює consultationAttended/consultationAttendanceValue/consultationAttendanceSetAt і викликає saveDirectClient, щоб lastActivityKeys встановився (крапочка для «Підтвердив запис»)
- `sync-consultation-attendance` — `lastActivityKeys: ['consultationAttended']`
- `sync-paid-service-dates` (cron) — `lastActivityKeys: ['paidServiceAttended']` або `['paidServiceCancelled']`
- Chat status API — `lastActivityKeys: ['chatStatusId']`
- Binotel call — `lastActivityKeys: ['binotel_call']`

---

## 2. Фронтенд: winningKey

[`web/app/admin/direct/_components/DirectClientTable.tsx`](web/app/admin/direct/_components/DirectClientTable.tsx)

### Умови показу крапочки

Крапочка показується, якщо:

1. `sortBy === 'updatedAt'` (режим «За активністю»)
2. `lastActivityAt` = сьогодні ( Kyiv timezone)
3. `lastActivityKeys` не порожній (або визначено fallback-ключ — див. нижче)

**Обов’язкова умова:** червона крапочка є обов’язковою для кожного візиту, піднятого вгору. Тобто для кожного клієнта, який відображається вгорі списку за сортуванням «За активністю» (активність сьогодні), крапочка має бути показана. Якщо `lastActivityKeys` порожній через запізнення оновлення або race — використовується fallback за даними клієнта (наприклад, `consultationAttendanceSetAt` / `statusSetAt` сьогодні), щоб крапочка все одно відображалась у відповідній колонці.

### DOT_PRIORITY (пріоритет тригерів)

Клієнт може мати кілька змін. Використовується один ключ — `winningKey`:

```ts
DOT_PRIORITY = [
  'statusId', 'chatStatusId', 'message', 'binotel_call',
  'consultationBookingDate', 'consultationRecordCreatedAt', 'consultationAttended', 'consultationCancelled',
  'paidServiceDate', 'paidServiceRecordCreatedAt', 'paidServiceAttended', 'paidServiceCancelled',
  'paidServiceTotalCost',
]
```

`winningKey` = перший ключ з `DOT_PRIORITY`, який є в `lastActivityKeys`. Якщо в режимі «За активністю» активність сьогодні, але `lastActivityKeys` порожній — обчислюється fallback-ключ за даними клієнта (`consultationAttendanceSetAt` / `statusSetAt` / платний запис сьогодні), щоб крапочка залишалась обов’язковою для кожного візиту, піднятого вгору.

### Відповідність winningKey → колонка

| winningKey | Де показується крапочка |
|------------|-------------------------|
| statusId | Колонка «Статус» |
| chatStatusId | Колонка «Статус» |
| message | Колонка «Inst» |
| binotel_call | Колонка «Дзвінки» |
| consultationBookingDate, consultationRecordCreatedAt, consultationAttended, consultationCancelled | Колонка «Консультація» |
| paidServiceDate, paidServiceRecordCreatedAt, paidServiceAttended, paidServiceCancelled, paidServiceTotalCost | Колонка «Запис» |

---

## 3. Логіка по колонках

### Колонка «Консультація»

**Елементи:** букінгдата (дата), іконка статусу (✅/синя галочка/❌/🚫/⏳), дата створення запису.

Правила:

1. Якщо в `activityKeys` є `consultationAttended` або `consultationCancelled` → крапочка **біля іконки статусу** (синя галочка «Підтвердив запис» або інший статус).
2. Якщо `winningKey` — `consultationBookingDate` або `consultationRecordCreatedAt` → крапочка **біля букінгдати**.

**Fallback (коли lastActivityKeys перезаписано):**  
Якщо `winningKey` — дата, але:
- є синя галочка (`consultationAttendanceValue === 2`)
- статус встановлено сьогодні (`consultationAttendanceSetAt` = сьогодні Kyiv)

то крапочка все одно показується біля іконки статусу. Це покриває випадок, коли пізніший синк перезаписав `lastActivityKeys` без `consultationAttended`.

### Колонка «Запис» (платний запис)

**Елементи:** дата візиту, іконка перезапису 🔁, іконка присутності (✅/❌/🚫/⏳), дата створення + сума.

Правила:

1. Якщо є перезапис (`paidServiceIsRebooking`) і `winningKey` ∈ {`paidServiceDate`, `paidServiceRecordCreatedAt`, `paidServiceTotalCost`} → крапочка **біля іконки перезапису 🔁**.
2. Інакше за `winningKey`:
   - `paidServiceDate` → на даті візиту
   - `paidServiceRecordCreatedAt` → на даті візиту
   - `paidServiceTotalCost` → біля суми (тис.)
   - `paidServiceAttended` / `paidServiceCancelled` → біля іконки присутності

---

## 4. Компоненти UI

### CornerRedDot і WithCornerRedDot

```tsx
function CornerRedDot({ title, className })  // Сама крапочка 8×8px
function WithCornerRedDot({ show, title, dotClassName, children })  // Обгортка
```

`title` використовується для tooltip (наприклад, «Тригер: змінилась присутність консультації»).

### getTriggerDescription

Функція для текстового опису тригера (наприклад, в модалках): повертає рядок типу «Відвідування консультації» за масивом `activityKeys`.

---

## 5. Діагностика

- У колонці «Act» у tooltip є `lastActivityKeys` (при `debugActivity` — додаткові дані)
- Endpoint `sync-consultation-for-client` може робити `lastActivityKeysRepair` — додає `consultationAttended`, `consultationCancelled` або `paidServiceRecordCreatedAt`, якщо запис/консультація сьогодні, але ключа немає в `lastActivityKeys`
- GET `/api/admin/direct/clients` додає `consultationAttended`/`consultationCancelled` до `lastActivityKeys` in-memory (для відповіді), якщо attendance злито з KV, ключа немає в БД, але `lastActivityAt` = сьогодні

---

## 6. Відомі проблеми та обмеження

**Race condition при API,KV:**  
loadClients (auto-refresh кожні 30 сек) може перезаписати стейт старими даними після того, як `sync-consultation-for-client` оновив клієнта. Крапочка з'являється, потім зникає, потім з'являється знову після наступного refresh. **Рішення:** пауза auto-refresh на 10 сек після onClientSynced (після натискання API,KV).

**Розсинхрон DB/KV:**  
`lastActivityKeys` зберігається тільки в БД; merge з KV для `consultationAttended` не оновлює ключі. Якщо вебхук не оновив `lastActivityKeys`, але attendance є в KV — показуємо правильний статус, але без крапочки. **Рішення:** in-memory доповнення при GET (див. §5), lastActivityKeysRepair у sync-consultation-for-client.

**Відсутність attendance у KV:**  
Якщо вебхук відсутній або запізнився, KV може не містити no-show/arrived для консультації. **Рішення:** sync-consultation-for-client (секція 2.5) використовує Altegio API (GET /records) як fallback. При натисканні API,KV для клієнта attendance з API застосовується до БД.

---

## 7. Схема потоку даних

```
Зміна даних (вебхук / sync / UI)
    ↓
saveDirectClient або прямий Prisma update з lastActivityKeys
    ↓
lastActivityKeys + lastActivityAt у БД
    ↓
GET /api/admin/direct/clients повертає клієнтів з lastActivityKeys
    ↓
DirectClientTable: winningKey = DOT_PRIORITY.find(k => activityKeys.includes(k))
    ↓
Per-column: showDotOnX = winningKey === 'X' + локальні правила (перезапис, статус консультації)
    ↓
WithCornerRedDot(show={...}) рендерить крапочку
```

(Примітка: після sync API,KV — пауза auto-refresh 10 сек, щоб loadClients не перезаписав дані.)
