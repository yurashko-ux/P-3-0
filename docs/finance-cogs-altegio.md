# Собівартість товару (COGS) у фінзвіті vs Altegio

Документ для швидкого контексту в нових чатах: **як рахуємо рядок «Собівартість товару»** і чому він має збігатися з кабінетом Altegio (наприклад **207 322 грн.** при виручці «Товари» **373 270 грн.** за квітень 2026).

## Де в коді

- Головна логіка: `web/lib/altegio/inventory.ts` (функція зведення продажів товару за місяць, кандидати COGS, лог `[COGS_SUMMARY]`).
- База V2 API (опційно): `web/lib/altegio/env.ts` — `altegioUrlV2()` (`ALTEGIO_API_URL_V2` або заміна `/api/v1` → `/api/v2`).
- Клієнт: `web/lib/altegio/client.ts` — для шляхів `/locations/...` query без зайвого `partner_id`.

## Еталон у UI Altegio

У зведеному фінзвіті за місяць:

- **Товари** — виручка з аналітики (у нас часто `salonGoodsRevenueUah` / totals.goods).
- **Собівартість товару** — цільовий рядок; узгодження з кабінетом вважається успіхом, якщо наш обраний `costSource` і `finalCost` відповідають цьому рядку.

## Джерело `goods_card` (картки товарів × складські продажі)

1. Беремо складські транзакції продажу (`type_id = 1`) за період — масив `sales`.
2. Для унікальних `good_id` тягнемо картки **V1**: `GET /goods/{location_id}/{product_id}` → мапа `goodsById`.
3. Опційно збагачуємо **V2**: `GET /locations/{location_id}/products/{id}` → поле `cost_price` на картці (якщо токен/host дозволяють; інакше в логах «0 успіхів» і приклад HTTP-помилки).
4. Агрегуємо по товару **підписану кількість**: `quantity = Σ amount` по рядках `sales` (повернення з протилежним знаком зменшують нетто).

### Критично: знак `amount` у Altegio

У `goods_transactions` для продажу **`amount` від’ємний** (списання зі складу).

Собівартість періоду в звіті — **додатна** величина (витрата). Тому для кожного товару:

```text
рядок COGS = -costPerUnit × netQty
```

де `netQty` — це вже згадана агрегована `quantity` (сума підписаних `amount`).

**Помилка, яку виправлено:** формула `costPerUnit × netQty` давала **від’ємну** суму (за модулем правильну, напр. −207 322). Далі `Math.max(0, totalCost)` обнуляв кандидата, і вибір падав на `goods_transactions.actual_cost` (інша сума, напр. 239 744).

Реалізація: `calculateCostFromGoodsCards()` у `inventory.ts`.

## Собівартість за одиницю з картки: `getGoodCardCostPerUnit`

Пріоритет полів (спрощено):

1. V2 `cost_price` (якщо після збагачення є на об’єкті).
2. V1 `unit_actual_cost` × `unit_equals` (якщо обидва > 0), інакше лише `unit_actual_cost`.
3. V1 `actual_cost` (часто «загальна», не завжди за одиницю — обережно в коментарях у коді).
4. Fallback: `default_cost_per_unit`, `purchase_price`, `wholesale_price` (не брати сирі поля ціни продажу як COGS).

## Вибір фінальної COGS: `costCandidates`

Перший кандидат після фільтрів (не збігається з виручкою «Товари» тощо) виграє. Порядок додавання в масив (спрощено; деталі — умови `leadActualCostFirst`, `preferFirstCostDocumentBasis`, `actualInsertedEarly` у коді):

| Пріоритет (типово) | `source`              | Зміст |
|--------------------|------------------------|--------|
| За евристикою      | `sale_document_first`  | Вузька база з документів продажу (first/prime/purchase поля) |
| Якщо є pick        | `analytics_goods`      | З analytics / `income_goods_stats` extras |
| Часто ключовий     | **`goods_card`**       | **−costPerUnit × Σamount** по картках + V2 |
| За умовами лідера  | `actual_cost`          | Σ `actual_cost` з `goods_transactions` по продажах |
| Далі               | `sale_document`        | Blended / default з документів продажу (з cap на виручку) |
| …                  | `fallback`, `manual`   | Резервні джерела, KV |

Лог для діагностики одним JSON: **`[COGS_SUMMARY]`** — у повідомленні має бути `source`, `finalCost`, `revenueGoodsRow`, `docBlended`, `actualCostSum`, `capBase` тощо.

## Обмеження (cap)

Якщо собівартість з документів (blended) **> capBase × 1.05** (capBase з виручки «Товари» або складу — див. код), blended відкидається; у логах **`[cogs-cap]`**.

## Що перевірити, якщо знову «не як у кабінеті»

1. Розгорнути логи запиту фінзвіту / `inventory` і знайти **`[COGS_SUMMARY]`**.
2. Якщо `goods_card` відсутній: чи `totalCost` знову ≤ 0 (знак/агрегація), чи немає `costPerUnit` для частини товарів (`unmatchedGoods`).
3. Якщо V2 завжди з помилкою: `ALTEGIO_API_URL_V2`, права токена, шлях `/locations/{id}/products/{product_id}`.

Останнє узгодження з рядком **207 322 / 373 270** (квітень 2026): виправлення знаку в **`calculateCostFromGoodsCards`** (`-costPerUnit * netQty`).
