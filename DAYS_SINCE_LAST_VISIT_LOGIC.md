# Логіка оновлення "Днів з останнього візиту"

## 📊 Обчислення daysSinceLastVisit

### Місце обчислення
**Файл:** `web/app/api/admin/direct/clients/route.ts` (рядки 860-947)

### Умови для обчислення

1. **Джерело даних:** Тільки `client.lastVisitAt` з бази даних (який синхронізується з Altegio API)
   - ❌ НЕ використовуються fallback поля (`paidServiceDate`, `visitDate`, `consultationBookingDate`)
   - ✅ Тільки дані з Altegio API

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

### 1. Автоматичний Cron Job (щогодини)
**Файл:** `web/app/api/cron/sync-direct-altegio-metrics/route.ts`
**Розклад:** `0 * * * *` (щогодини о 0 хвилин)

**ВАЖЛИВО:** Для синхронізації lastVisitAt потрібна змінна середовища `ALTEGIO_COMPANY_ID` в Vercel. Якщо вона не налаштована — cron пропускає lastVisitAt і в логах буде: `⚠️ ALTEGIO_COMPANY_ID не налаштовано — пропускаємо lastVisitAt`.

**Перевірка:** AdminToolsModal → «Перевірити статус cron job (sync-direct-altegio-metrics)» — покаже `ALTEGIO_COMPANY_ID: ✅ налаштовано` або `❌ не налаштовано`.
**Endpoint:** `/api/cron/sync-direct-altegio-metrics`

#### Умови оновлення:
```typescript
// 1. Клієнт має altegioClientId
if (!client.altegioClientId) continue;

// 2. Altegio повернув last_visit_date для цього клієнта
const lv = lastVisitMap.get(client.altegioClientId);
if (!lv) continue; // Пропускаємо, якщо немає даних в Altegio

// 3. Порівнюємо поточне значення з новим
const current = client.lastVisitAt ? String(client.lastVisitAt) : '';
const currentTs = current ? new Date(current).getTime() : NaN;
const nextTs = new Date(lv).getTime();

// 4. Оновлюємо тільки якщо:
//    - nextTs валідний (Number.isFinite)
//    - І поточне значення відсутнє (NaN) АБО відрізняється
if (Number.isFinite(nextTs) && (!Number.isFinite(currentTs) || currentTs !== nextTs)) {
  updates.lastVisitAt = new Date(nextTs).toISOString();
}
```

#### Джерело даних:
- Використовує `fetchAltegioLastVisitMap()` - пакетне отримання через `clients/search` API
- Отримує `last_visit_date` для всіх клієнтів одним запитом

---

### 2. Ручна синхронізація (Admin Panel)
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

### 3. Вебхуки Altegio (при attendance=1)
**Файл:** `web/app/api/altegio/webhook/route.ts`

#### Тригери:
- **Консультація з attendance=1:**
  ```typescript
  // Коли клієнт прийшов на консультацію
  if (event === 'appointment' && type === 'consultation' && attendance === 1) {
    const metrics = await syncClientMetricsFromAltegio(altegioClientId);
    if (metrics.lastVisitAt) {
      updates.lastVisitAt = metrics.lastVisitAt;
    }
  }
  ```

- **Платна послуга з attendance=1:**
  ```typescript
  // Коли клієнт прийшов на платну послугу
  if (event === 'appointment' && type === 'paid_service' && attendance === 1) {
    const metrics = await syncClientMetricsFromAltegio(altegioClientId);
    if (metrics.lastVisitAt) {
      updates.lastVisitAt = metrics.lastVisitAt;
    }
  }
  ```

#### Умови:
- Тільки коли `attendance === 1` (клієнт реально прийшов)
- Викликає `syncClientMetricsFromAltegio()` - отримує дані з Altegio API
- Оновлює `lastVisitAt` тільки якщо Altegio повернув значення

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

### 5. Синхронізація через direct-store
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

### Завжди оновлюється, якщо:
1. ✅ Altegio API повернув `last_visit_date` для клієнта
2. ✅ Клієнт має `altegioClientId`
3. ✅ Нова дата валідна (`Number.isFinite(nextTs)`)
4. ✅ Поточна дата відсутня (`NaN`) АБО відрізняється від нової

### Ніколи не оновлюється, якщо:
1. ❌ Клієнт не має `altegioClientId`
2. ❌ Altegio не повернув `last_visit_date` для цього клієнта
3. ❌ Нова дата невалідна
4. ❌ Поточна дата вже дорівнює новій (в режимі `onlyMissing=1` може пропустити)

### Особливості:
- **Не затирається на null** - якщо Altegio не повернув дату, поточне значення залишається
- **Часовий пояс:** Europe/Kyiv для коректного обчислення днів
- **updatedAt НЕ змінюється** при технічному синку (щоб не "плив" в таблиці)

---

## 🔧 Cron не спрацьовує / lastVisitAt не оновлюється

### Можливі причини

1. **ALTEGIO_COMPANY_ID не налаштовано** — найчастіша причина. Додайте в Vercel → Settings → Environment Variables для Production.

2. **Cron тільки на Production** — Vercel запускає cron лише для Production deployment, не для Preview.

3. **KV не зберігає heartbeat** — якщо KV недоступний, heartbeat не пишеться, але cron все одно виконується. Перевірте Vercel logs.

4. **Ручний запуск для діагностики:**
   ```
   GET https://p-3-0.vercel.app/api/cron/sync-direct-altegio-metrics?secret=YOUR_CRON_SECRET
   ```

5. **Vercel Dashboard** — перевірте Cron Jobs та логи виконання.

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
