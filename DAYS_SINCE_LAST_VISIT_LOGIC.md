# Логіка оновлення "Днів з останнього візиту"

## 📊 Обчислення daysSinceLastVisit

### Місце обчислення
**Файл:** `web/app/api/admin/direct/clients/route.ts` (рядки 860-947)

### Умови для обчислення

1. **Джерело даних:** `client.lastVisitAt` з бази даних.
   - **Основний тригер:** вебхук Altegio при `attendance=1` (консультація або платна послуга) — lastVisitAt = дата візиту з вебхука (`data.datetime`), без виклику Altegio API.
   - **Пріоритет:** для «Днів» рахуємо тільки візити В САЛОНІ (оплачена послуга). Консультація НЕ рахується. Джерела: (1) `paidServiceDate` при `paidServiceAttended === true`, (2) fallback — `lastVisitAt` з Altegio.
   - Ручна синхронізація (кнопка в адмінці) дозволяє вирівняти lastVisitAt з Altegio за потреби.

2. **Алгоритм обчислення:**
   ```typescript
   // 1. Отримуємо lastVisitAt (ISO string)
   const iso = client.lastVisitAt?.toString().trim();
   
   // 2. Якщо lastVisitAt відсутній → daysSinceLastVisit = undefined
   if (!iso) return { ...client, daysSinceLastVisit: undefined };
   
   // 3. Конвертуємо в дату по Києву (Europe/Kyiv)
   const day = kyivDayFromISO(iso); // "YYYY-MM-DD"
   
   // 4. Конвертуємо дату в індекс днів (кількість днів з 1970-01-01)
   const idx = toDayIndex(day);
   
   // 5. Якщо індекс невалідний → daysSinceLastVisit = undefined
   if (!Number.isFinite(idx)) return { ...c, daysSinceLastVisit: undefined };
   
   // 6. Обчислюємо різницю днів
   const diff = todayIdx - idx;
   const daysSinceLastVisit = diff < 0 ? 0 : diff; // Якщо майбутнє → 0
   ```

3. **Часовий пояс:** Europe/Kyiv (важливо для коректного обчислення днів)

4. **Результат:**
   - `number` - кількість днів (0 або більше)
   - `undefined` - якщо `lastVisitAt` відсутній або невалідний

---

## 🔄 Тригери оновлення lastVisitAt

### 1. Вебхук Altegio (при attendance=1) — основний тригер
**Файл:** `web/app/api/altegio/webhook/route.ts`

При відмітці «прийшов» (attendance=1) у консультації або платній послузі lastVisitAt встановлюється **датою візиту з вебхука** (`data.datetime`), без виклику Altegio API.

- **Консультація:** `lastVisitAtFromWebhookDatetime(datetime, existingClient.lastVisitAt)` — не перезаписуємо на старішу дату.
- **Платна послуга:** те саме для `data.datetime`.
- spent/visits як і раніше синхронізуються з Altegio через `syncClientMetricsFromAltegio`.

### 2. Крон — не оновлює lastVisitAt
**Файл:** `web/app/api/cron/sync-direct-altegio-metrics/route.ts`

Крон синхронізує лише **phone, spent, visits**. lastVisitAt оновлюється тільки вебхуком (attendance=1) та ручною кнопкою.

### 3. Ручна синхронізація (Admin Panel)
**Файл:** `web/app/api/admin/direct/sync-last-visit/route.ts`
**Endpoint:** `/api/admin/direct/sync-last-visit`
**Кнопка в AdminToolsModal:** "Синхронізувати lastVisitAt з Altegio"

#### Умови оновлення:
```typescript
// 1. Клієнт має altegioClientId
if (!client.altegioClientId) continue;

// 2. Altegio повернув last_visit_date
const lv = lastVisitMap.get(client.altegioClientId);
if (!lv) {
  skippedNoLastVisit++;
  continue;
}

// 3. Режим onlyMissing=0 (FORCE) - оновлюємо всіх
//    Режим onlyMissing=1 - оновлюємо тільки тих, у кого немає lastVisitAt
const current = client.lastVisitAt ? String(client.lastVisitAt) : '';
if (onlyMissing && current) {
  skippedExists++;
  continue; // Пропускаємо, якщо вже є значення
}

// 4. Порівнюємо дати
const currentTs = current ? new Date(current).getTime() : NaN;
const nextTs = new Date(lv).getTime();

if (!Number.isFinite(nextTs)) {
  skippedNoLastVisit++;
  continue;
}

// 5. Оновлюємо якщо дати відрізняються
if (Number.isFinite(currentTs) && currentTs === nextTs) {
  skippedNoChange++;
  continue;
}

// 6. Оновлюємо
lastVisitAt: new Date(nextTs).toISOString()
```

#### Параметри:
- `onlyMissing=0` - FORCE режим (перезаписує всіх, навіть якщо вже є lastVisitAt)
- `onlyMissing=1` - оновлює тільки тих, у кого немає lastVisitAt
- `dryRun=1` - тестовий режим (не зберігає зміни)

---

### 4. Синхронізація при створенні нового клієнта
**Файл:** `web/app/api/admin/direct/sync-altegio-bulk/route.ts`

#### Умови:
```typescript
// При створенні нового клієнта з Altegio
if (altegioClient.id) {
  const altegioClientData = await getClient(companyId, altegioClient.id);
  const raw = altegioClientData?.last_visit_date ?? null;
  
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      lastVisitAt: d.toISOString()
    }
  }
}
```

---

### 5. Синхронізація через direct-store (за потреби)
**Файл:** `web/lib/direct-store.ts` (функція `syncAltegioClientMetricsOnce`)

#### Умови:
```typescript
// Викликається при збереженні клієнта (якщо не skipAltegioMetricsSync)
if (nextLastVisitAt) {
  const cur = current.lastVisitAt ? String(current.lastVisitAt) : '';
  const curTs = cur ? new Date(cur).getTime() : NaN;
  const nextTs = new Date(nextLastVisitAt).getTime();
  
  // Оновлюємо якщо:
  // - nextTs валідний
  // - І поточне відсутнє АБО відрізняється
  if (Number.isFinite(nextTs) && (!Number.isFinite(curTs) || curTs !== nextTs)) {
    updates.lastVisitAt = nextLastVisitAt;
  }
}
```

---

## 📋 Підсумок умов оновлення

### Основний тригер (вебхук):
- При **attendance=1** (консультація або платна послуга) lastVisitAt = дата візиту з вебхука (`data.datetime`). Не перезаписується на старішу дату.

### Ручна синхронізація:
- Кнопка в адмінці вирівнює lastVisitAt з Altegio API (`last_visit_date`) за потреби.

### Особливості:
- **Не затирається на null** — якщо нової дати немає, поточне значення залишається.
- **Часовий пояс:** Europe/Kyiv для коректного обчислення днів.

---

## 🔧 Якщо lastVisitAt не оновлюється

- **Вебхук:** переконайтесь, що Altegio відправляє події з attendance=1 при відмітці «прийшов». lastVisitAt оновлюється миттєво з дати візиту вебхука.
- **Ручна синхронізація:** кнопка в розділі статистика дозволяє один раз вирівняти lastVisitAt з Altegio (потрібен ALTEGIO_COMPANY_ID).
- Крон більше не оновлює lastVisitAt (тільки phone, spent, visits).

---

## 🎨 Відображення в UI

**Файл:** `web/app/admin/direct/_components/DirectClientTable.tsx` (рядки 1828-1861)

### Кольори:
- **Сірий** (`bg-gray-200`) - немає даних або ≤ 60 днів
- **Жовтий** (`bg-amber-200`) - 61-90 днів
- **Червоний** (`bg-red-200`) - > 90 днів

### Tooltip:
- Показує кількість днів
- Показує дату останнього візиту (якщо є)
- Формат: "Днів з останнього візиту: X\nДата останнього візиту: YYYY-MM-DD"
