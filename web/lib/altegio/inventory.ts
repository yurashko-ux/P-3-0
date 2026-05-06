// web/lib/altegio/inventory.ts
// Транзакції по товарах (inventory) + агрегована виручка по товарах за період

import { ALTEGIO_ENV, altegioUrlV2 } from "./env";
import { altegioFetch } from "./client";

// Тип транзакції складу з API
export type AltegioStorageTransaction = {
  id: number;
  type_id: number;
  amount: number;
  cost_per_unit: number;
  cost: number;
  create_date: string;
  good_id?: number;
  good?: {
    id: number;
    title: string;
  };
  [key: string]: any;
};


/** Інформація про проданий товар */
export type SoldGoodItem = {
  goodId?: number;
  title: string; // Назва товару
  quantity: number; // Кількість проданих одиниць
  costPerUnit: number; // Собівартість за одиницю
  totalCost: number; // Загальна собівартість (costPerUnit * quantity)
};

type WarehouseBalanceDetailedResult = {
  total: number;
  storages: WarehouseStorageBalanceRow[];
  source: "goods_current_actual_amounts" | "transactions_as_of_date" | "current_minus_transactions_after_date";
  diagnostics?: WarehouseBalanceDiagnostics;
};

type WarehouseBalanceDiagnostics = {
  goodsRows: number;
  goodsWithQuantity: number;
  uniqueGoodsWithQuantity: number;
  duplicateGoodsWithQuantity: number;
  duplicateGoodsValueUah: number;
  totalQuantity: number;
  valuationTotalFromCurrentGoods: number;
  averageValuationUnit: number | null;
  rewind?: {
    periodAfter: string;
    transactionsAfter: number;
    rowsWithSignedQuantity: number;
    reversedRows: number;
    reversedDelta: number;
    inboundUah: number;
    salesUah: number;
    otherWriteOffsUah: number;
    otherSignedUah: number;
    byType: Array<{ typeId: number; count: number; signedQty: number; valueUah: number; sampleType: string | null }>;
    sampleRows: Array<{
      id: number | null;
      typeId: number | null;
      type: string;
      goodId: number | null;
      storageId: number;
      signedQty: number;
      unitPrice: number;
      valueUah: number;
      date: string;
    }>;
  };
  sampleGoods: Array<{
    id: number | null;
    title: string;
    quantity: number;
    valuationUnit: number;
    keys: string[];
    priceCandidates: Record<string, unknown>;
    actualAmountSample: Record<string, unknown> | null;
  }>;
  duplicateGoodsSample?: Array<{
    id: number;
    title: string;
    rows: number;
    quantity: number;
    valueUah: number;
  }>;
};

type WarehouseRewindDiagnostics = NonNullable<WarehouseBalanceDiagnostics["rewind"]>;

/** Агрегована інформація по продажах товарів за період */
export type GoodsSalesSummary = {
  range: { date_from: string; date_to: string };
  revenue: number; // Виручка з транзакцій (може бути нижча за реальну)
  cost: number; // Собівартість (ручно введене значення з KV або 0)
  profit: number; // Націнка (revenue - cost)
  costSource?:
    | "goods_card"
    | "purchase_match"
    | "sale_document"
    /** Σ first_cost / first_cost_total по рядках документа (часто збігається з «Аналіз продажів», коли default_cost завищує COGS) */
    | "sale_document_first"
    | "actual_cost"
    /** Числове поле з income_goods_stats (GET analytics/overall), якщо API віддає собівартість окремо від current_sum */
    | "analytics_goods"
    | "manual"
    | "fallback"
    | "none"; // Джерело собівартості
  itemsCount: number; // Загальна кількість транзакцій продажу
  totalItemsSold: number; // Загальна кількість проданих одиниць товару
  costItemsCount?: number; // Загальна кількість одиниць товару, по яких розраховано собівартість з API
  costTransactionsCount?: number; // Кількість транзакцій, по яких успішно розраховано собівартість
  goodsList?: SoldGoodItem[]; // Список проданих товарів з деталями
  /**
   * Наближена «чиста зміна» складу в грн з GET /storages/transactions за період:
   * надходження (type_id=2 закупівля + type_id=3 прийомка) мінус COGS мінус списання (евристика за `type`);
   * у impliedNetChangeUah — мінус **фінальна** COGS звіту; у impliedNetChangeGoodsCardUah — COGS з карток.
   * Переміщення між складами не враховані; інші type_id — див. лог розподілу.
   */
  warehouseMovementEstimate?: {
    /** Сума надходжень: type_id=2 + type_id=3 (грн) */
    purchasesTotalUah: number;
    purchasesType2TotalUah: number;
    purchasesType2Count: number;
    receiptsType3TotalUah: number;
    receiptsType3Count: number;
    writeOffsTotalUah: number;
    writeOffTransactionsCount: number;
    /** COGS за обраним джерелом звіту (finalCost) — для порівняння з картками */
    costOfGoodsSoldUah: number;
    /** Надходження (2+3) − COGS (звіт) − списання */
    impliedNetChangeUah: number;
    /** Σ(−cost×qty) з карток товарів (та сама база, що для узгодження з Altegio); null якщо не пораховано */
    cogsGoodsCardUah: number | null;
    /** Надходження (2+3) − COGS (картки) − списання; для rollforward від KV-якоря */
    impliedNetChangeGoodsCardUah: number | null;
    salesTransactionsCount: number;
    purchaseTransactionsCount: number;
  };
};

function parseNumericUnknown(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(String(v).replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * Шукаємо в «зайвих» ключах income_goods_stats число в розумному коридорі від виручки по товарах
 * (якщо Altegio віддає собівартість окремим полем — без хардкоду сум).
 */
function pickGoodsCostFromIncomeGoodsStatsExtras(
  extras: Record<string, unknown> | undefined,
  goodsRevenue: number,
): number | null {
  if (!extras || !(goodsRevenue > 0)) return null;
  let best: { key: string; value: number; score: number } | null = null;
  for (const [key, raw] of Object.entries(extras)) {
    const n = parseNumericUnknown(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (n >= goodsRevenue * 0.995) continue;
    const ratio = n / goodsRevenue;
    if (ratio < 0.22 || ratio > 0.78) continue;
    const kl = key.toLowerCase();
    let score = 0;
    if (/cost|соб|prime|purchase|закуп|self|sebest|собівартість|inprime|net_cost|закупівл/.test(kl)) score += 12;
    if (/good|товар|product|sold|inventory/.test(kl)) score += 2;
    if (/margin|маржа|profit|gain|нац/.test(kl)) score -= 8;
    if (/discount|зниж|sale_sum|вируч|revenue|current_sum/.test(kl)) score -= 10;
    const rounded = Math.round(n * 100) / 100;
    if (!best || score > best.score || (score === best.score && rounded < best.value)) {
      best = { key, value: rounded, score };
    }
  }
  if (best && best.score >= 8) {
    console.log(
      `[altegio/inventory] ℹ️ income_goods_stats: кандидат COGS з поля «${best.key}» = ${best.value} грн (score=${best.score}, виручка товари=${goodsRevenue})`,
    );
    return best.value;
  }
  return null;
}

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;

  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error(
      "ALTEGIO_COMPANY_ID is required to fetch inventory transactions (optionally can fall back to ALTEGIO_PARTNER_ID / ALTEGIO_APPLICATION_ID)",
    );
  }
  return companyId;
}

function unwrapAltegioPayload<T = any>(raw: any): T | null {
  if (!raw || typeof raw !== "object") return null;
  if ("data" in raw && (raw as any).data != null) {
    const data = (raw as any).data;
    if (data && typeof data === "object" && "data" in data && (data as any).data != null) {
      return (data as any).data as T;
    }
    return data as T;
  }
  return raw as T;
}

function extractActualCostFromGoodsTransaction(raw: any): { actualCost: number | null; amount: number } {
  const payload = unwrapAltegioPayload<any>(raw);
  const good = payload && typeof payload === "object" ? payload.good : null;
  const amt = Number(payload?.amount);
  const qtyAlt =
    Number(payload?.quantity) || Number(payload?.count) || Number(payload?.qty) || 0;
  const primary = Number.isFinite(amt) && amt !== 0 ? amt : qtyAlt;
  if (!Number.isFinite(primary) || primary === 0) {
    return { actualCost: null, amount: 0 };
  }
  const amount = Math.abs(primary);
  const lineSign = primary < 0 ? -1 : 1;

  const actualCost = Number(good?.actual_cost);
  if (Number.isFinite(actualCost) && actualCost >= 0) {
    return { actualCost: lineSign * Math.abs(actualCost), amount };
  }

  const unitActualCost = Number(good?.unit_actual_cost);
  if (Number.isFinite(unitActualCost) && unitActualCost >= 0 && amount > 0) {
    return { actualCost: lineSign * Math.abs(unitActualCost) * amount, amount };
  }

  return { actualCost: null, amount };
}

async function fetchActualCostForSalesTransactions(
  companyId: string,
  sales: any[],
): Promise<{ totalCost: number; successfulTransactions: number }> {
  if (sales.length === 0) {
    return { totalCost: 0, successfulTransactions: 0 };
  }

  const batchSize = 10;
  let totalCost = 0;
  let successfulTransactions = 0;

  console.log(
    `[altegio/inventory] 🔍 Отримуємо actual_cost для ${sales.length} продажів через goods_transactions`,
  );

  for (let i = 0; i < sales.length; i += batchSize) {
    const batch = sales.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (sale) => {
        const transactionId = Number(sale?.id) || 0;
        if (!transactionId) {
          return null;
        }

        try {
          const path = `/storage_operations/goods_transactions/${companyId}/${transactionId}`;
          const details = await altegioFetch<any>(path);
          const parsed = extractActualCostFromGoodsTransaction(details);
          if (parsed.actualCost != null) {
            return parsed.actualCost;
          }

          console.log(
            `[altegio/inventory] ⚠️ goods_transactions/${transactionId}: actual_cost відсутній`,
          );
          return null;
        } catch (err: any) {
          console.warn(
            `[altegio/inventory] ⚠️ Не вдалося отримати goods_transaction ${transactionId}:`,
            err?.message || String(err),
          );
          return null;
        }
      }),
    );

    for (const cost of results) {
      if (typeof cost === "number" && Number.isFinite(cost) && cost !== 0) {
        totalCost += cost;
        successfulTransactions += 1;
      }
    }

    if (i + batchSize < sales.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log(
    `[altegio/inventory] ✅ actual_cost по продажах: ${totalCost} грн. (успішно: ${successfulTransactions}/${sales.length})`,
  );

  return {
    totalCost: Math.round(Math.max(0, totalCost) * 100) / 100,
    successfulTransactions,
  };
}

async function fetchAllStorageTransactions(params: {
  companyId: string;
  date_from: string;
  date_to: string;
}): Promise<any[]> {
  const { companyId, date_from, date_to } = params;
  const countPerPage = 1000;
  const allTransactions: any[] = [];

  for (let page = 1; page <= 100; page += 1) {
    const qs = new URLSearchParams({
      start_date: date_from,
      end_date: date_to,
      page: String(page),
      count: String(countPerPage),
    });

    const path = `/storages/transactions/${companyId}?${qs.toString()}`;
    const raw = await altegioFetch<any>(path);
    const pageItems: any[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as any).data)
        ? (raw as any).data
        : [];

    allTransactions.push(...pageItems);

    console.log(
      `[altegio/inventory] 📄 storages/transactions page=${page}, count=${pageItems.length}`,
    );

    if (pageItems.length < countPerPage) {
      break;
    }
  }

  console.log(
    `[altegio/inventory] ✅ Усього отримано транзакцій складу за період: ${allTransactions.length}`,
  );

  return allTransactions;
}

/** Вартість рядка складської транзакції в грн: `cost` або `cost_per_unit`×|amount|. */
function sumStorageTransactionsCostUah(transactions: any[]): number {
  if (!transactions.length) return 0;
  return (
    Math.round(
      transactions.reduce((sum, t) => {
        const totalLine = Math.abs(Number(t.cost) || 0);
        if (totalLine > 0) return sum + totalLine;
        const costPerUnit = Number(t.cost_per_unit) || 0;
        const amount = Math.abs(Number(t.amount) || 0);
        return sum + costPerUnit * amount;
      }, 0) * 100,
    ) / 100
  );
}

/** Діагностика: які type_id реально приходять з Altegio за період. */
function logStorageTransactionTypeSummary(transactions: any[], label: string): void {
  const byId = new Map<number, { count: number; typeSample: string }>();
  for (const t of transactions) {
    const id = Number(t?.type_id);
    if (!Number.isFinite(id)) continue;
    const cur = byId.get(id) || { count: 0, typeSample: "" };
    cur.count += 1;
    if (!cur.typeSample && t?.type != null) cur.typeSample = String(t.type).slice(0, 56);
    byId.set(id, cur);
  }
  const rows = [...byId.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([type_id, v]) => ({ type_id, count: v.count, type: v.typeSample || null }));
  console.log(
    `[altegio/inventory] Розподіл складських транзакцій за type_id (${label}, ${transactions.length} рядків):`,
    JSON.stringify(rows),
  );
}

/**
 * Списання товару зі складу (не продаж клієнту type_id=1).
 * type_id=2 закупівля, 3 прийомка — не списання. Інші type_id перевіряємо за рядком `type`;
 * якщо у вас списання з «порожнім» type — див. лог розподілу та розширте правило.
 */
function isStorageWriteoffTransaction(t: any): boolean {
  const tid = Number(t?.type_id);
  if (!Number.isFinite(tid)) return false;
  if (tid === 1 || tid === 2 || tid === 3) return false;
  const typeStr = String(t?.type ?? "").toLowerCase();
  if (
    typeStr.includes("relocat") ||
    typeStr.includes("переміщ") ||
    typeStr.includes("transfer between")
  ) {
    return false;
  }
  if (
    typeStr.includes("write-off") ||
    typeStr.includes("writeoff") ||
    typeStr.includes("write off") ||
    typeStr.includes("списан") ||
    typeStr.includes("утиліза") ||
    typeStr.includes("зіпс") ||
    typeStr.includes("damage") ||
    (typeStr.includes("consumption") && !typeStr.includes("sale"))
  ) {
    return true;
  }
  return false;
}

function getSaleDocumentItems(raw: any): any[] {
  const payload = unwrapAltegioPayload<any>(raw);
  const state = payload && typeof payload === "object" ? payload.state : null;

  if (Array.isArray(state?.items)) return state.items;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

/** Дочірній рядок комплекту — собівартість уже в батьківській позиції; інакше Σ як у «Аналізі продажів» роздувається */
function isCompositeChildSaleItem(item: any): boolean {
  if (item == null || typeof item !== "object") return false;
  const parentId = Number(
    item.parent_id ??
      item.parent_sale_item_id ??
      item.parent_item_id ??
      item.master_sale_item_id ??
      item.parent_selling_unit_id ??
      0,
  );
  if (parentId > 0) return true;
  const role = String(item.composite_role ?? item.composite_type ?? item.part_type ?? "").toLowerCase();
  if (role.includes("child") || role.includes("component") || role.includes("part")) return true;
  if (Number(item.is_child) === 1 || item.is_child === true) return true;
  return false;
}

/**
 * Собівартість рядка товару в документі продажу (узгоджено з кабінетом / «Аналіз продажів»).
 * Пріоритет: явні total → default_cost_total → first_cost_total → per-unit.
 */
function pickSaleDocumentLineCostTotalForGood(item: any, quantity: number): number {
  const g = item?.good && typeof item.good === "object" ? item.good : null;
  const fromTotal =
    Number(item?.manual_cost_total) ||
    Number(g?.manual_cost_total) ||
    Number(item?.default_cost_total) ||
    Number(g?.default_cost_total) ||
    Number(item?.first_cost_total) ||
    Number(g?.first_cost_total) ||
    0;
  if (Number.isFinite(fromTotal) && fromTotal !== 0) {
    return Math.abs(fromTotal);
  }
  const perUnit =
    Number(item?.manual_cost) ||
    Number(g?.manual_cost) ||
    Number(item?.default_cost_per_unit) ||
    Number(g?.default_cost_per_unit) ||
    Number(item?.first_cost) ||
    Number(g?.first_cost) ||
    0;
  if (perUnit > 0 && quantity > 0) {
    return Math.abs(perUnit * quantity);
  }
  return 0;
}

/**
 * Собівартість рядка лише за «первісною» закупівлею (first cost) — без manual/default.
 * У кабінеті Altegio «Аналіз продажів» по товарах часто саме ця сума нижча за Σ default_cost_total.
 * Додаткові поля (prime/purchase) — різні інстанси API віддають різні ключі; не змішуємо з default_cost.
 */
function pickSaleDocumentLineCostTotalFirstBasisOnly(item: any, quantity: number): number {
  const g = item?.good && typeof item.good === "object" ? item.good : null;
  const fromTotal =
    Number(item?.first_cost_total) ||
    Number(g?.first_cost_total) ||
    Number(item?.prime_cost_total) ||
    Number(g?.prime_cost_total) ||
    Number(item?.purchase_cost_total) ||
    Number(g?.purchase_cost_total) ||
    Number(item?.buy_cost_total) ||
    Number(g?.buy_cost_total) ||
    Number(item?.supplier_cost_total) ||
    Number(g?.supplier_cost_total) ||
    0;
  if (Number.isFinite(fromTotal) && fromTotal !== 0) {
    return Math.abs(fromTotal);
  }
  const perUnit =
    Number(item?.first_cost) ||
    Number(g?.first_cost) ||
    Number(item?.prime_cost) ||
    Number(g?.prime_cost) ||
    Number(item?.purchase_price) ||
    Number(g?.purchase_price) ||
    Number(item?.buy_price) ||
    Number(g?.buy_price) ||
    Number(item?.supplier_price) ||
    Number(g?.supplier_price) ||
    0;
  if (perUnit > 0 && quantity > 0) {
    return Math.abs(perUnit * quantity);
  }
  return 0;
}

function extractSaleDocumentGoods(raw: any, sale: any): {
  itemsCount: number;
  totalCost: number;
  /** Паралельна сума тільки з first_cost — для звірки з «Аналіз продажів» */
  totalFirstBasisCost: number;
  goods: SoldGoodItem[];
} {
  const items = getSaleDocumentItems(raw);
  if (!Array.isArray(items) || items.length === 0) {
    const amount = Math.abs(Number(sale?.amount) || 0);
    /** У транзакції складу cost_per_unit зазвичай ціна продажу — не підставляти як COGS (інакше Σ≈виручка) */
    return {
      itemsCount: amount,
      totalCost: 0,
      totalFirstBasisCost: 0,
      goods: [],
    };
  }

  const goods: SoldGoodItem[] = [];
  let itemsCount = 0;
  let totalCost = 0;
  let totalFirstBasisCost = 0;
  let skippedCompositeChildren = 0;

  for (const item of items) {
    const type = String(item?.type || "").toLowerCase();
    if (type && type !== "good") continue;
    if (isCompositeChildSaleItem(item)) {
      skippedCompositeChildren += 1;
      continue;
    }

    const amt = Number(item?.amount);
    const qtyAlt = Number(item?.quantity) || Number(item?.count) || Number(item?.qty) || 0;
    const primary = Number.isFinite(amt) && amt !== 0 ? amt : qtyAlt;
    if (!Number.isFinite(primary) || primary === 0) continue;

    const quantity = Math.abs(primary);
    /** Повернення: від’ємна кількість у документі — віднімаємо собівартість рядка */
    const lineSign = primary < 0 ? -1 : 1;

    const totalCostForItem = pickSaleDocumentLineCostTotalForGood(item, quantity);
    const firstBasisForItem = pickSaleDocumentLineCostTotalFirstBasisOnly(item, quantity);
    const costPerUnit =
      quantity > 0 && totalCostForItem > 0
        ? totalCostForItem / quantity
        : Number(item?.default_cost_per_unit) ||
          Number(item?.good?.default_cost_per_unit) ||
          0;
    const goodId = item?.good_id || item?.good?.id;
    const title =
      item?.title ||
      item?.good?.title ||
      item?.good?.name ||
      `Товар #${goodId || item?.id || sale?.id || "N/A"}`;

    itemsCount += quantity;
    const signedLineCost = lineSign * Math.abs(totalCostForItem);
    totalCost += signedLineCost;
    totalFirstBasisCost += lineSign * Math.abs(firstBasisForItem);
    goods.push({
      goodId,
      title,
      quantity,
      costPerUnit,
      totalCost: signedLineCost,
    });
  }

  if (skippedCompositeChildren > 0) {
    console.log(
      `[altegio/inventory] 📄 extractSaleDocumentGoods: пропущено ${skippedCompositeChildren} дочірніх рядків комплекту (собівартість лишається на батьківській позиції)`,
    );
  }

  return {
    itemsCount,
    totalCost: Math.max(0, Math.round(totalCost * 100) / 100),
    totalFirstBasisCost: Math.max(0, Math.round(totalFirstBasisCost * 100) / 100),
    goods,
  };
}

function mergeGoodsIntoMap(goodsMap: Map<number | string, SoldGoodItem>, goods: SoldGoodItem[]) {
  for (const good of goods) {
    const key = good.goodId || good.title;
    const existing = goodsMap.get(key);
    if (existing) {
      existing.quantity += good.quantity;
      existing.totalCost += good.totalCost;
      existing.costPerUnit = existing.quantity > 0 ? existing.totalCost / existing.quantity : 0;
      continue;
    }

    goodsMap.set(key, {
      ...good,
      costPerUnit: good.quantity > 0 ? good.totalCost / good.quantity : good.costPerUnit,
    });
  }
}

/**
 * ID документа продажу для GET /company/{id}/sale/{document_id}.
 * Не використовувати sale.id — це id складської транзакції, інакше документ не відкриється і Σ default_cost_total = 0.
 */
function getStorageSaleDocumentIdForFetch(sale: any): number {
  const raw = unwrapAltegioPayload<any>(sale) || sale;
  const candidates = [
    raw?.document_id,
    raw?.document?.id,
    raw?.sale_document_id,
    (raw as any)?.data?.document_id,
    sale?.document_id,
    sale?.document?.id,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return 0;
}

const MAX_GOODS_TX_DOC_ID_LOOKUPS = 280;

/** Якщо у списку продажів немає document_id — дістаємо його з деталі goods_transactions (там поле document_id). */
async function enrichSalesWithDocumentIdsFromGoodsTransactions(
  companyId: string,
  sales: any[],
): Promise<void> {
  const txIds = new Set<number>();
  for (const s of sales) {
    if (getStorageSaleDocumentIdForFetch(s) > 0) continue;
    const tid = Number(s?.id);
    if (Number.isFinite(tid) && tid > 0) {
      txIds.add(tid);
    }
  }
  if (txIds.size === 0) {
    return;
  }

  const ids = [...txIds];
  const capped = ids.length > MAX_GOODS_TX_DOC_ID_LOOKUPS ? ids.slice(0, MAX_GOODS_TX_DOC_ID_LOOKUPS) : ids;
  if (ids.length > MAX_GOODS_TX_DOC_ID_LOOKUPS) {
    console.warn(
      `[altegio/inventory] document_id відсутній у ${ids.length} транзакціях; lookup goods_transactions обмежено ${MAX_GOODS_TX_DOC_ID_LOOKUPS}`,
    );
  }

  const tidToDoc = new Map<number, number>();
  const batchSize = 12;
  for (let i = 0; i < capped.length; i += batchSize) {
    const slice = capped.slice(i, i + batchSize);
    const results = await Promise.all(
      slice.map(async (tid) => {
        try {
          const raw = await altegioFetch<any>(
            `/storage_operations/goods_transactions/${companyId}/${tid}`,
          );
          const u = unwrapAltegioPayload<any>(raw) || raw;
          const docId = Number(u?.document_id || (u as any)?.data?.document_id || 0);
          return { tid, docId: Number.isFinite(docId) && docId > 0 ? docId : 0 };
        } catch {
          return { tid, docId: 0 };
        }
      }),
    );
    for (const { tid, docId } of results) {
      if (docId > 0) {
        tidToDoc.set(tid, docId);
      }
    }
    if (i + batchSize < capped.length) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  let attached = 0;
  for (const s of sales) {
    if (getStorageSaleDocumentIdForFetch(s) > 0) {
      continue;
    }
    const tid = Number(s?.id);
    const docId = tidToDoc.get(tid);
    if (docId && docId > 0) {
      (s as any).document_id = docId;
      attached += 1;
    }
  }
  if (attached > 0) {
    console.log(
      `[altegio/inventory] Підставлено document_id з goods_transactions для ${attached} рядків продажу (для завантаження /sale/{document_id})`,
    );
  }
}

function unwrapGoodsList(raw: any): any[] {
  return Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).data)
      ? (raw as any).data
      : raw && typeof raw === "object" && Array.isArray((raw as any).goods)
        ? (raw as any).goods
        : raw && typeof raw === "object" && Array.isArray((raw as any).items)
          ? (raw as any).items
          : [];
}

/**
 * Собівартість за одиницю з картки товару (V1 /goods/{loc}/{id} + опційно V2 cost_price).
 * У документації Altegio: V2 `cost_price`; V1 спочатку `unit_actual_cost` (за одиницю), `actual_cost` часто «загальна» — не ставимо його вище за unit-chain.
 */
function getGoodCardCostPerUnit(good: any): number {
  if (!good || typeof good !== "object") return 0;

  const costPriceV2 = Number(good?.cost_price);
  if (Number.isFinite(costPriceV2) && costPriceV2 > 0) {
    return costPriceV2;
  }

  const unitActualCost = Number(good?.unit_actual_cost) || 0;
  const unitEquals = Number(good?.unit_equals) || 0;
  if (unitActualCost > 0 && unitEquals > 0) {
    return unitActualCost * unitEquals;
  }
  if (unitActualCost > 0) {
    return unitActualCost;
  }

  const actualCost = Number(good?.actual_cost) || 0;
  if (actualCost > 0) {
    return actualCost;
  }

  /** Не брати good.cost / cost_per_unit — у картці товару часто це ціна продажу, Σ≈виручка замість собівартості */
  return (
    Number(good?.default_cost_per_unit) ||
    Number(good?.purchase_price) ||
    Number(good?.wholesale_price) ||
    0
  );
}

/**
 * Одиниця для оцінки залишку на складі (грн за одиницю товару).
 * Для блоку №4 потрібно збігатися з екраном Altegio «Залишки по складах»,
 * який використовує фактичну складську собівартість, а не продажну ціну.
 * `cost` у картці часто є ціною продажу/подвоєною ціною, тому він тільки fallback.
 */
function getWarehouseStockValuationUnitPrice(good: any): number {
  const fromCostChain = getGoodCardCostPerUnit(good);
  if (fromCostChain > 0) {
    return fromCostChain;
  }

  return (
    Number(good.sale_price) ||
    Number(good.selling_price) ||
    Number(good.retail_price) ||
    Number(good.price_sale) ||
    Number(good.actual_sale_price) ||
    Number(good.price) ||
    Number(good.default_price) ||
    Number(good.cost_sale) ||
    Number(good.cost) ||
    Number(good.cost_per_unit) ||
    0
  );
}

// Altegio/YCLIENTS часто обмежує список товарів 50 рядками, навіть якщо просити більше.
// Якщо просити 500, перші 50 виглядають як "остання сторінка" і залишки складу недораховуються.
const GOODS_LIST_PAGE_SIZE = 50;
const GOODS_LIST_MAX_PAGES = 400;
// Блок #4 фінзвіту має відповідати звіту Altegio "Залишки на складах" з фільтром складу "Товари".
const WAREHOUSE_BALANCE_REPORT_STORAGE_IDS = new Set([2343838]);
const WAREHOUSE_BALANCE_REPORT_STORAGE_TITLES = new Set(["товари"]);

function normalizeWarehouseStorageTitle(title?: string): string {
  return (title || "").trim().toLocaleLowerCase("uk-UA");
}

function isWarehouseBalanceReportStorage(storageId: number, title?: string): boolean {
  if (WAREHOUSE_BALANCE_REPORT_STORAGE_IDS.has(storageId)) return true;
  const normalizedTitle = normalizeWarehouseStorageTitle(title);
  return normalizedTitle ? WAREHOUSE_BALANCE_REPORT_STORAGE_TITLES.has(normalizedTitle) : false;
}

function getWarehouseGoodRowKey(g: any, fallbackIndex: number): string {
  const id = Number(g?.good_id ?? g?.id ?? 0);
  const base = id > 0 ? `id:${id}` : `anon:${fallbackIndex}`;

  if (Array.isArray(g?.actual_amounts) && g.actual_amounts.length > 0) {
    const amountsKey = g.actual_amounts
      .map((amount: any) => {
        const parsed = parseActualAmountEntry(amount);
        return `${parsed.storageId}:${parsed.qty}:${parsed.title || ""}`;
      })
      .sort()
      .join("|");
    return `${base}:actual:${amountsKey}`;
  }

  const storageId = Number(
    g?.storage_id ??
      g?.storageId ??
      g?.storages_id ??
      g?.storage?.id ??
      g?.storage?.storage_id ??
      0,
  );
  if (Number.isFinite(storageId) && storageId > 0) {
    return `${base}:storage:${storageId}`;
  }

  return base;
}

function mergeWarehouseGoodsDedupe(items: any[]): any[] {
  const map = new Map<string, any>();
  let anonIdx = 0;
  for (const g of items) {
    const key = getWarehouseGoodRowKey(g, anonIdx++);
    if (!map.has(key)) {
      map.set(key, g);
    }
  }
  return [...map.values()];
}

/**
 * Деякі інстанси Altegio/YCLIENTS ігнорують page/count і повторюють першу порцію;
 * тоді offset/limit інколи все одно зсуває вікно вибірки.
 */
async function tryFetchGoodsOffsetLimit(basePath: string, label: string): Promise<any[]> {
  const limit = GOODS_LIST_PAGE_SIZE;
  const all: any[] = [];
  for (let offset = 0; offset <= limit * GOODS_LIST_MAX_PAGES; offset += limit) {
    try {
      const qs = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      const raw = await altegioFetch<any>(`${basePath}?${qs.toString()}`);
      const batch = unwrapGoodsList(raw);
      if (batch.length === 0) {
        break;
      }
      all.push(...batch);
      if (batch.length < limit) {
        break;
      }
    } catch (err: any) {
      console.warn(
        `[altegio/inventory] ${label} offset/limit зупинено на offset=${offset}:`,
        err?.message || String(err),
      );
      break;
    }
  }
  const out = mergeWarehouseGoodsDedupe(all);
  console.log(`[altegio/inventory] ${label}: offset/limit → ${out.length} унікальних товарів (сирих ${all.length})`);
  return out;
}

/**
 * Altegio часто віддає список товарів сторінками (?page=&count=); без циклу береться лише перша порція —
 * сума в CRM тоді радикально нижча за «Залишки» в інтерфейсі Altegio.
 */
async function tryFetchPagedOrSingleGoods(basePath: string, label: string): Promise<any[]> {
  try {
    const qsFirst = new URLSearchParams({
      page: "1",
      count: String(GOODS_LIST_PAGE_SIZE),
    });
    const rawFirst = await altegioFetch<any>(`${basePath}?${qsFirst.toString()}`);
    const batchFirst = unwrapGoodsList(rawFirst);

    // Якщо з query все порожньо — пробуємо без параметрів (старий режим API).
    if (batchFirst.length === 0) {
      const rawSingle = await altegioFetch<any>(basePath);
      const single = unwrapGoodsList(rawSingle);
      console.log(`[altegio/inventory] ${label}: ${single.length} товарів (один запит без pagination)`);
      return mergeWarehouseGoodsDedupe(single);
    }

    const all: any[] = [...batchFirst];
    let prevUniqueCount = mergeWarehouseGoodsDedupe(all).length;
    let stoppedForDuplicate = false;

    for (let page = 2; page <= GOODS_LIST_MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        page: String(page),
        count: String(GOODS_LIST_PAGE_SIZE),
      });
      const raw = await altegioFetch<any>(`${basePath}?${qs.toString()}`);
      const batch = unwrapGoodsList(raw);
      if (batch.length === 0) {
        break;
      }
      all.push(...batch);
      const newUniqueCount = mergeWarehouseGoodsDedupe(all).length;
      if (newUniqueCount === prevUniqueCount) {
        stoppedForDuplicate = true;
        console.warn(
          `[altegio/inventory] ${label}: page=${page} не додав нових good_id після dedupe — ймовірно API ігнорує page/count, відкочуємо порцію`,
        );
        all.splice(all.length - batch.length, batch.length);
        break;
      }
      prevUniqueCount = newUniqueCount;
      if (batch.length < GOODS_LIST_PAGE_SIZE) {
        break;
      }
    }

    const firstDeduped = mergeWarehouseGoodsDedupe(batchFirst);
    let finalDeduped = mergeWarehouseGoodsDedupe(all);
    const uniqueStuckAtFirstPage =
      finalDeduped.length === firstDeduped.length &&
      firstDeduped.length > 0 &&
      (batchFirst.length >= GOODS_LIST_PAGE_SIZE || stoppedForDuplicate);

    if (uniqueStuckAtFirstPage) {
      const viaOffset = await tryFetchGoodsOffsetLimit(basePath, `${label} (fallback offset)`);
      if (viaOffset.length > finalDeduped.length) {
        console.warn(
          `[altegio/inventory] ${label}: page/count дав лише ${finalDeduped.length} унікальних, offset/limit — ${viaOffset.length}; беремо offset`,
        );
        finalDeduped = viaOffset;
      }
    }

    console.log(
      `[altegio/inventory] ${label}: ${finalDeduped.length} унікальних товарів (pagination, сирих рядків ${all.length})`,
    );
    return finalDeduped;
  } catch (err: any) {
    console.warn(`[altegio/inventory] ${label} pagination недоступна або помилка:`, err?.message || String(err));
    try {
      const raw = await altegioFetch<any>(basePath);
      const goods = unwrapGoodsList(raw);
      console.log(`[altegio/inventory] ${label}: fallback один запит — ${goods.length} товарів`);
      return mergeWarehouseGoodsDedupe(goods);
    } catch (err2: any) {
      console.warn(`[altegio/inventory] ${label} повний провал:`, err2?.message || String(err2));
      return [];
    }
  }
}

function roundMoney2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Рядок залишку по одному складу (блок №4 фінансового звіту).
 * storageId = 0 — агреговано без прив’язки до складу в API або fallback за транзакціями.
 */
export type WarehouseStorageBalanceRow = {
  storageId: number;
  title: string;
  balanceUah: number;
};

async function fetchGoodsListForWarehouseBalance(companyId: string): Promise<any[]> {
  const primaryPath = `/goods/${companyId}`;
  let goods = await tryFetchPagedOrSingleGoods(primaryPath, `GET ${primaryPath}`);

  if (goods.length === 0) {
    const fallbackPaths = [`/storages/${companyId}/goods`, `/company/${companyId}/goods`];
    for (const fallbackPath of fallbackPaths) {
      console.log(`[altegio/inventory] Спроба fallback: ${fallbackPath}`);
      goods = await tryFetchPagedOrSingleGoods(fallbackPath, `GET ${fallbackPath}`);
      if (goods.length > 0) {
        break;
      }
    }
  }

  if (goods.length > 0) {
    const sampleGood = goods[0];
    console.log(`[altegio/inventory] Зразок товару для складу:`, {
      id: sampleGood.id ?? sampleGood.good_id,
      title: sampleGood.title || sampleGood.name,
      hasActualAmounts: Array.isArray(sampleGood.actual_amounts),
      actualAmountsLength: Array.isArray(sampleGood.actual_amounts) ? sampleGood.actual_amounts.length : 0,
      valuationUnit: getWarehouseStockValuationUnitPrice(sampleGood),
      keysSample: Object.keys(sampleGood).slice(0, 24),
    });
    if (Array.isArray(sampleGood.actual_amounts) && sampleGood.actual_amounts.length > 0) {
      console.log(
        `[altegio/inventory] Sample actual_amounts[0]:`,
        JSON.stringify(sampleGood.actual_amounts[0], null, 2),
      );
    }
  }

  return goods;
}

function getWarehouseGoodTotalQuantity(good: any): number {
  if (Array.isArray(good.actual_amounts) && good.actual_amounts.length > 0) {
    return good.actual_amounts.reduce((sum: number, amount: any) => {
      return sum + parseActualAmountEntry(amount).qty;
    }, 0);
  }

  return Math.abs(
    Number(good.amount) ||
      Number(good.quantity) ||
      Number(good.count) ||
      Number(good.qty) ||
      Number(good.balance) ||
      Number(good.stock) ||
      Number(good.total_amount) ||
      0,
  );
}

function getWarehouseGoodReportQuantity(good: any): number {
  if (Array.isArray(good.actual_amounts) && good.actual_amounts.length > 0) {
    return good.actual_amounts.reduce((sum: number, amount: any) => {
      const parsed = parseActualAmountEntry(amount);
      return isWarehouseBalanceReportStorage(parsed.storageId, parsed.title) ? sum + parsed.qty : sum;
    }, 0);
  }

  return Math.abs(
    Number(good.amount) ||
      Number(good.quantity) ||
      Number(good.count) ||
      Number(good.qty) ||
      Number(good.balance) ||
      Number(good.stock) ||
      Number(good.total_amount) ||
      0,
  );
}

async function enrichWarehouseGoodsForBalance(companyId: string, goods: any[]): Promise<any[]> {
  const ids = goods
    .filter((good) => getWarehouseGoodTotalQuantity(good) > 0)
    .map((good) => Number(good?.good_id ?? good?.id ?? 0))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (ids.length === 0) {
    return goods;
  }

  const detailsById = await fetchGoodsCardsByIds(companyId, ids);
  await enrichGoodsCardsWithV2CostPrice(companyId, detailsById);

  let enriched = 0;
  const merged = goods.map((good) => {
    const id = Number(good?.good_id ?? good?.id ?? 0);
    const detail = id > 0 ? detailsById.get(id) : null;
    if (!detail) return good;
    enriched++;
    return {
      ...good,
      ...detail,
      // Кількість/склади беремо зі списку залишків, а цінові поля — з детальної картки.
      actual_amounts: Array.isArray(good.actual_amounts) ? good.actual_amounts : detail.actual_amounts,
      amount: good.amount ?? detail.amount,
      quantity: good.quantity ?? detail.quantity,
      count: good.count ?? detail.count,
      qty: good.qty ?? detail.qty,
      balance: good.balance ?? detail.balance,
      stock: good.stock ?? detail.stock,
      total_amount: good.total_amount ?? detail.total_amount,
    };
  });

  const sample = merged.find((good) => getWarehouseGoodTotalQuantity(good) > 0);
  console.log("[altegio/inventory] Збагачено товари для оцінки складу:", {
    rows: goods.length,
    ids: new Set(ids).size,
    enriched,
    sample: sample
      ? {
          id: sample.id ?? sample.good_id,
          title: sample.title || sample.name,
          quantity: getWarehouseGoodTotalQuantity(sample),
          valuationUnit: getWarehouseStockValuationUnitPrice(sample),
          priceFields: {
            sale_price: sample.sale_price,
            selling_price: sample.selling_price,
            retail_price: sample.retail_price,
            price: sample.price,
            default_price: sample.default_price,
            cost: sample.cost,
            cost_per_unit: sample.cost_per_unit,
            actual_cost: sample.actual_cost,
            unit_actual_cost: sample.unit_actual_cost,
          },
        }
      : null,
  });

  return merged;
}

async function getWarehouseBalanceFromTransactions(companyId: string, date: string): Promise<number> {
  const qs = new URLSearchParams({
    start_date: "2000-01-01",
    end_date: date,
  });
  const txPath = `/storages/transactions/${companyId}?${qs.toString()}`;
  const raw = await altegioFetch<any>(txPath);
  const tx: any[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).data)
      ? (raw as any).data
      : [];

  const balance = tx.reduce((sum, t) => {
    const typeId = Number(t.type_id);
    const amount = Math.abs(Number(t.amount) || 0);
    const costPerUnit = Number(t.cost_per_unit) || 0;
    if (amount > 0 && costPerUnit > 0) {
      const value = amount * costPerUnit;
      return sum + (typeId === 1 ? -value : value);
    }
    return sum;
  }, 0);

  console.log(
    `[altegio/inventory] Warehouse balance on ${date} (calculated from transactions): ${balance} (from ${tx.length} transactions)`,
  );
  return balance;
}

function parseActualAmountEntry(amount: any): { storageId: number; qty: number; title?: string } {
  const qty =
    typeof amount === "object" && amount !== null
      ? Math.abs(
          Number(amount.amount) ||
            Number(amount.quantity) ||
            Number(amount.count) ||
            Number(amount.qty) ||
            0,
        )
      : Math.abs(Number(amount) || 0);

  if (typeof amount !== "object" || amount === null) {
    return { storageId: 0, qty };
  }

  const storageId = Number(
    amount.storage_id ??
      amount.storageId ??
      amount.storages_id ??
      amount.storage?.id ??
      amount.storage?.storage_id ??
      0,
  );

  const titleRaw =
    amount.storage_title ??
    amount.storage_name ??
    amount.storage?.title ??
    amount.storage?.name ??
    amount.title;
  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";

  return { storageId: Number.isFinite(storageId) ? storageId : 0, qty, title: title || undefined };
}

function computeTotalWarehouseBalanceFromGoods(goods: any[]): number {
  let totalBalance = 0;
  for (const good of goods) {
    const costPerUnit = getWarehouseStockValuationUnitPrice(good);
    if (costPerUnit <= 0) continue;

    let totalQuantity = 0;
    if (Array.isArray(good.actual_amounts) && good.actual_amounts.length > 0) {
      totalQuantity = good.actual_amounts.reduce((sum: number, amount: any) => {
        const parsed = parseActualAmountEntry(amount);
        return isWarehouseBalanceReportStorage(parsed.storageId, parsed.title) ? sum + parsed.qty : sum;
      }, 0);
    }
    if (totalQuantity === 0) {
      totalQuantity = Math.abs(
        Number(good.amount) ||
          Number(good.quantity) ||
          Number(good.count) ||
          Number(good.qty) ||
          Number(good.balance) ||
          Number(good.stock) ||
          Number(good.total_amount) ||
          0,
      );
    }
    if (totalQuantity > 0 && costPerUnit > 0) {
      totalBalance += totalQuantity * costPerUnit;
    }
  }
  return totalBalance;
}

function computePerStorageBalancesFromGoods(goods: any[]): Map<number, { balance: number; title?: string }> {
  const byId = new Map<number, { balance: number; title?: string }>();
  const add = (id: number, delta: number, title?: string) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    const cur = byId.get(id) || { balance: 0, title: undefined };
    cur.balance += delta;
    if (title && !cur.title) cur.title = title;
    byId.set(id, cur);
  };

  for (const good of goods) {
    const costPerUnit = getWarehouseStockValuationUnitPrice(good);
    if (costPerUnit <= 0) continue;

    if (Array.isArray(good.actual_amounts) && good.actual_amounts.length > 0) {
      const entries = good.actual_amounts
        .map(parseActualAmountEntry)
        .filter((e) => e.qty > 0 && isWarehouseBalanceReportStorage(e.storageId, e.title));
      if (entries.length === 0) continue;

      const hasPositiveStorage = entries.some((e) => e.storageId > 0);
      if (hasPositiveStorage) {
        for (const e of entries) {
          const sid = e.storageId > 0 ? e.storageId : 0;
          add(sid, e.qty * costPerUnit, e.title);
        }
      } else {
        const sumQty = entries.reduce((s, e) => s + e.qty, 0);
        add(0, sumQty * costPerUnit, undefined);
      }
      continue;
    }

    const totalQuantity = Math.abs(
      Number(good.amount) ||
        Number(good.quantity) ||
        Number(good.count) ||
        Number(good.qty) ||
        Number(good.balance) ||
        Number(good.stock) ||
        Number(good.total_amount) ||
        0,
    );
    if (totalQuantity > 0) {
      add(0, totalQuantity * costPerUnit, undefined);
    }
  }

  return byId;
}

function pickObjectKeysContaining(source: any, words: string[]): Record<string, unknown> {
  if (!source || typeof source !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const normalized = key.toLowerCase();
    if (words.some((word) => normalized.includes(word))) {
      const value = source[key];
      if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
        out[key] = value;
      } else if (Array.isArray(value)) {
        out[key] = `[array:${value.length}]`;
      } else if (typeof value === "object") {
        out[key] = "[object]";
      }
    }
  }
  return out;
}

function buildWarehouseBalanceDiagnostics(
  goods: any[],
  valuationTotalFromCurrentGoods: number,
  rewind?: WarehouseRewindDiagnostics,
): WarehouseBalanceDiagnostics {
  let goodsWithQuantity = 0;
  let totalQuantity = 0;
  const sampleGoods: WarehouseBalanceDiagnostics["sampleGoods"] = [];
  const byGoodId = new Map<number, { title: string; rows: number; quantity: number; valueUah: number }>();

  for (const good of goods) {
    const quantity = getWarehouseGoodReportQuantity(good);
    if (quantity > 0) {
      goodsWithQuantity++;
      totalQuantity += quantity;
      const id = Number(good?.good_id ?? good?.id ?? 0);
      if (Number.isFinite(id) && id > 0) {
        const unit = getWarehouseStockValuationUnitPrice(good);
        const existing = byGoodId.get(id) || {
          title: String(good?.title || good?.name || "").slice(0, 80),
          rows: 0,
          quantity: 0,
          valueUah: 0,
        };
        existing.rows++;
        existing.quantity += quantity;
        existing.valueUah += quantity * unit;
        byGoodId.set(id, existing);
      }
    }
    if (quantity > 0 && sampleGoods.length < 8) {
      const actualAmountSample =
        Array.isArray(good.actual_amounts) && good.actual_amounts[0] && typeof good.actual_amounts[0] === "object"
          ? {
              ...pickObjectKeysContaining(good.actual_amounts[0], [
                "amount",
                "qty",
                "count",
                "price",
                "cost",
                "sum",
                "total",
                "value",
                "balance",
                "storage",
              ]),
            }
          : null;
      sampleGoods.push({
        id: Number(good?.good_id ?? good?.id ?? 0) || null,
        title: String(good?.title || good?.name || "").slice(0, 80),
        quantity,
        valuationUnit: getWarehouseStockValuationUnitPrice(good),
        keys: Object.keys(good).slice(0, 80),
        priceCandidates: pickObjectKeysContaining(good, [
          "price",
          "cost",
          "sale",
          "retail",
          "sum",
          "total",
          "value",
          "amount",
          "balance",
        ]),
        actualAmountSample,
      });
    }
  }

  const duplicateGoods = Array.from(byGoodId.entries())
    .filter(([, row]) => row.rows > 1)
    .map(([id, row]) => ({
      id,
      title: row.title,
      rows: row.rows,
      quantity: Math.round(row.quantity * 1000) / 1000,
      valueUah: roundDiagMoney(row.valueUah),
    }))
    .sort((a, b) => b.valueUah - a.valueUah);
  const duplicateGoodsValueUah = roundDiagMoney(duplicateGoods.reduce((sum, row) => sum + row.valueUah, 0));
  const duplicateGoodsSample = duplicateGoods.slice(0, 20);

  return {
    goodsRows: goods.length,
    goodsWithQuantity,
    uniqueGoodsWithQuantity: byGoodId.size,
    duplicateGoodsWithQuantity: duplicateGoods.length,
    duplicateGoodsValueUah,
    totalQuantity: Math.round(totalQuantity * 100) / 100,
    valuationTotalFromCurrentGoods,
    averageValuationUnit:
      totalQuantity > 0 ? Math.round((valuationTotalFromCurrentGoods / totalQuantity) * 100) / 100 : null,
    rewind,
    sampleGoods,
    duplicateGoodsSample,
  };
}

function mapToWarehouseStorageRows(byId: Map<number, { balance: number; title?: string }>): WarehouseStorageBalanceRow[] {
  const rows: WarehouseStorageBalanceRow[] = [];
  for (const [storageId, { balance, title }] of byId.entries()) {
    if (Math.abs(balance) < 1e-9) continue;
    const label =
      storageId === 0
        ? title?.trim() || "Без розбивки по складах"
        : title?.trim() || `Склад #${storageId}`;
    rows.push({
      storageId,
      title: label,
      balanceUah: roundMoney2(balance),
    });
  }
  rows.sort((a, b) => {
    if (a.storageId === 0) return 1;
    if (b.storageId === 0) return -1;
    return a.storageId - b.storageId;
  });
  return rows;
}

function getKyivIsoDateOnly(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getStorageInfoFromTransaction(t: any): { storageId: number; title?: string } {
  const storageId = Number(
    t?.storage_id ??
      t?.storageId ??
      t?.storages_id ??
      t?.storage?.id ??
      t?.storage?.storage_id ??
      0,
  );
  const titleRaw =
    t?.storage_title ??
    t?.storage_name ??
    t?.storage?.title ??
    t?.storage?.name ??
    "";
  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
  return {
    storageId: Number.isFinite(storageId) ? storageId : 0,
    title: title || undefined,
  };
}

function getGoodIdFromStorageTransaction(t: any): number {
  const id = Number(t?.good_id ?? t?.product_id ?? t?.good?.id ?? t?.product?.id ?? 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function getStorageTransactionRowKey(t: any, fallbackIndex: number): string {
  const id = Number(t?.id);
  const goodId = getGoodIdFromStorageTransaction(t);
  const storage = getStorageInfoFromTransaction(t);
  const amount = Number(t?.amount) || 0;
  const date = String(t?.create_date ?? t?.date ?? t?.operation_date ?? "");
  const typeId = Number(t?.type_id) || 0;
  if (Number.isFinite(id) && id > 0) {
    return `${id}:${goodId}:${storage.storageId}:${typeId}:${amount}:${date}`;
  }
  return `anon:${fallbackIndex}:${goodId}:${storage.storageId}:${typeId}:${amount}:${date}`;
}

function getSignedStorageQuantity(t: any): number {
  const rawAmount = Number(t?.amount);
  if (!Number.isFinite(rawAmount) || rawAmount === 0) return 0;

  const typeId = Number(t?.type_id);
  if (typeId === 1) return -Math.abs(rawAmount); // продаж товару
  if (typeId === 2 || typeId === 3) return Math.abs(rawAmount); // закупівля / прийомка
  if (isStorageWriteoffTransaction(t)) return -Math.abs(rawAmount);

  // Для переміщень Altegio зазвичай віддає підписану кількість по складах; зберігаємо знак API.
  return rawAmount;
}

function getStorageTransactionFallbackUnitPrice(t: any): number {
  const costPerUnit = Math.abs(Number(t?.cost_per_unit) || 0);
  if (costPerUnit > 0) return costPerUnit;
  const totalCost = Math.abs(Number(t?.cost) || 0);
  const amount = Math.abs(Number(t?.amount) || 0);
  return totalCost > 0 && amount > 0 ? totalCost / amount : 0;
}

function getStorageTransactionDate(t: any): string {
  return String(t?.create_date ?? t?.date ?? t?.operation_date ?? t?.datetime ?? "");
}

function createEmptyRewindDiagnostics(periodAfter: string, transactionsAfter: number): WarehouseRewindDiagnostics {
  return {
    periodAfter,
    transactionsAfter,
    rowsWithSignedQuantity: 0,
    reversedRows: 0,
    reversedDelta: 0,
    inboundUah: 0,
    salesUah: 0,
    otherWriteOffsUah: 0,
    otherSignedUah: 0,
    byType: [],
    sampleRows: [],
  };
}

function roundDiagMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

async function getWarehouseBalanceFromTransactionsDetailed(
  companyId: string,
  date: string,
  goods: any[],
): Promise<WarehouseBalanceDetailedResult> {
  const tx = await fetchStorageTransactionsForHistoricalBalance(companyId, date);

  const goodsById = new Map<number, any>();
  for (const good of goods) {
    const id = Number(good?.good_id ?? good?.id ?? 0);
    if (Number.isFinite(id) && id > 0) goodsById.set(id, good);
  }

  const byStorage = new Map<number, { balance: number; title?: string }>();
  let matchedByGoodCard = 0;
  let fallbackByTransaction = 0;

  const add = (storageId: number, delta: number, title?: string) => {
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return;
    const cur = byStorage.get(storageId) || { balance: 0, title: undefined };
    cur.balance += delta;
    if (title && !cur.title) cur.title = title;
    byStorage.set(storageId, cur);
  };

  for (const t of tx) {
    const signedQty = getSignedStorageQuantity(t);
    if (!Number.isFinite(signedQty) || signedQty === 0) continue;

    const goodId = getGoodIdFromStorageTransaction(t);
    const good = goodId > 0 ? goodsById.get(goodId) : null;
    let unitPrice = good ? getWarehouseStockValuationUnitPrice(good) : 0;
    if (unitPrice > 0) {
      matchedByGoodCard++;
    } else {
      unitPrice = getStorageTransactionFallbackUnitPrice(t);
      if (unitPrice > 0) fallbackByTransaction++;
    }
    if (unitPrice <= 0) continue;

    const storage = getStorageInfoFromTransaction(t);
    if (!isWarehouseBalanceReportStorage(storage.storageId, storage.title)) continue;
    add(storage.storageId, signedQty * unitPrice, storage.title);
  }

  const storages = mapToWarehouseStorageRows(byStorage);
  const total = roundMoney2(storages.reduce((sum, row) => sum + row.balanceUah, 0));
  const diagnostics = buildWarehouseBalanceDiagnostics(goods, total);

  console.log(`[altegio/inventory] ✅ Warehouse balance on ${date} (historical from transactions):`, {
    total,
    transactions: tx.length,
    storageRows: storages.length,
    goodsPriceMatches: matchedByGoodCard,
    transactionPriceFallbacks: fallbackByTransaction,
  });

  return { total, storages, source: "transactions_as_of_date", diagnostics };
}

async function getWarehouseBalanceByRewindingCurrentStock(
  companyId: string,
  date: string,
  goods: any[],
): Promise<WarehouseBalanceDetailedResult> {
  const currentByStorage = computePerStorageBalancesFromGoods(goods);
  const todayKyiv = getKyivIsoDateOnly();
  const from = addDaysIso(date, 1);
  const txAfter = from <= todayKyiv
    ? await fetchStorageTransactionsForPeriodByMonths(companyId, from, todayKyiv)
    : [];

  const byStorage = new Map<number, { balance: number; title?: string }>();
  for (const [storageId, row] of currentByStorage.entries()) {
    byStorage.set(storageId, { ...row });
  }

  const goodsById = new Map<number, any>();
  for (const good of goods) {
    const id = Number(good?.good_id ?? good?.id ?? 0);
    if (Number.isFinite(id) && id > 0) goodsById.set(id, good);
  }

  const add = (storageId: number, delta: number, title?: string) => {
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return;
    const cur = byStorage.get(storageId) || { balance: 0, title: undefined };
    cur.balance += delta;
    if (title && !cur.title) cur.title = title;
    byStorage.set(storageId, cur);
  };

  const periodAfter = `${from}…${todayKyiv}`;
  const rewindDiagnostics = createEmptyRewindDiagnostics(periodAfter, txAfter.length);
  const typeStats = new Map<number, { count: number; signedQty: number; valueUah: number; sampleType: string | null }>();
  let reversedRows = 0;
  for (const t of txAfter) {
    const signedQty = getSignedStorageQuantity(t);
    if (!Number.isFinite(signedQty) || signedQty === 0) continue;
    rewindDiagnostics.rowsWithSignedQuantity++;
    const goodId = getGoodIdFromStorageTransaction(t);
    const good = goodId > 0 ? goodsById.get(goodId) : null;
    let unitPrice = good ? getWarehouseStockValuationUnitPrice(good) : 0;
    if (unitPrice <= 0) unitPrice = getStorageTransactionFallbackUnitPrice(t);
    if (unitPrice <= 0) continue;

    const storage = getStorageInfoFromTransaction(t);
    if (!isWarehouseBalanceReportStorage(storage.storageId, storage.title)) continue;
    const typeId = Number(t?.type_id ?? t?.typeId ?? t?.type?.id ?? 0);
    const type = String(t?.type_title ?? t?.type?.title ?? t?.type ?? "");
    const valueUah = signedQty * unitPrice;
    const stat = typeStats.get(typeId) || { count: 0, signedQty: 0, valueUah: 0, sampleType: type || null };
    stat.count++;
    stat.signedQty += signedQty;
    stat.valueUah += valueUah;
    if (type && !stat.sampleType) stat.sampleType = type;
    typeStats.set(typeId, stat);

    if (signedQty > 0 && (typeId === 2 || typeId === 3)) {
      rewindDiagnostics.inboundUah += valueUah;
    } else if (signedQty < 0 && typeId === 1) {
      rewindDiagnostics.salesUah += Math.abs(valueUah);
    } else if (signedQty < 0) {
      rewindDiagnostics.otherWriteOffsUah += Math.abs(valueUah);
    } else {
      rewindDiagnostics.otherSignedUah += valueUah;
    }

    if (rewindDiagnostics.sampleRows.length < 12) {
      rewindDiagnostics.sampleRows.push({
        id: Number.isFinite(Number(t?.id)) ? Number(t?.id) : null,
        typeId: Number.isFinite(typeId) && typeId !== 0 ? typeId : null,
        type,
        goodId: goodId > 0 ? goodId : null,
        storageId: storage.storageId,
        signedQty,
        unitPrice,
        valueUah: roundDiagMoney(valueUah),
        date: getStorageTransactionDate(t),
      });
    }

    // Щоб отримати стан на дату, від поточного стану віднімаємо всі рухи після дати.
    add(storage.storageId, -valueUah, storage.title);
    rewindDiagnostics.reversedDelta += -valueUah;
    reversedRows++;
  }
  rewindDiagnostics.reversedRows = reversedRows;
  rewindDiagnostics.reversedDelta = roundMoney2(rewindDiagnostics.reversedDelta);
  rewindDiagnostics.inboundUah = roundMoney2(rewindDiagnostics.inboundUah);
  rewindDiagnostics.salesUah = roundMoney2(rewindDiagnostics.salesUah);
  rewindDiagnostics.otherWriteOffsUah = roundMoney2(rewindDiagnostics.otherWriteOffsUah);
  rewindDiagnostics.otherSignedUah = roundMoney2(rewindDiagnostics.otherSignedUah);
  rewindDiagnostics.byType = Array.from(typeStats.entries())
    .map(([typeId, stat]) => ({
      typeId,
      count: stat.count,
      signedQty: Math.round(stat.signedQty * 1000) / 1000,
      valueUah: roundDiagMoney(stat.valueUah),
      sampleType: stat.sampleType,
    }))
    .sort((a, b) => Math.abs(b.valueUah) - Math.abs(a.valueUah));

  const storages = mapToWarehouseStorageRows(byStorage);
  const total = roundMoney2(storages.reduce((sum, row) => sum + row.balanceUah, 0));
  const currentRows = mapToWarehouseStorageRows(currentByStorage);
  const currentTotal = roundMoney2(currentRows.reduce((sum, row) => sum + row.balanceUah, 0));
  const diagnostics = buildWarehouseBalanceDiagnostics(goods, currentTotal, rewindDiagnostics);
  console.log(`[altegio/inventory] ✅ Warehouse balance on ${date} (current minus transactions after date):`, {
    total,
    currentTotal,
    periodAfter,
    transactionsAfter: txAfter.length,
    reversedRows,
    reversedDelta: rewindDiagnostics.reversedDelta,
    storageRows: storages.length,
  });

  return { total, storages, source: "current_minus_transactions_after_date", diagnostics };
}

function addMonths(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function formatMonthDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function fetchStorageTransactionsForHistoricalBalance(
  companyId: string,
  dateTo: string,
): Promise<any[]> {
  return fetchStorageTransactionsForPeriodByMonths(companyId, `${Math.max(2020, Number(dateTo.slice(0, 4)) - 8)}-01-01`, dateTo);
}

async function fetchStorageTransactionsForPeriodByMonths(
  companyId: string,
  dateFrom: string,
  dateTo: string,
): Promise<any[]> {
  const [targetYearRaw, targetMonthRaw] = dateTo.split("-").map(Number);
  const targetYear = Number.isFinite(targetYearRaw) ? targetYearRaw : new Date().getFullYear();
  const targetMonth = Number.isFinite(targetMonthRaw) ? targetMonthRaw : new Date().getMonth() + 1;
  const [startYearRaw, startMonthRaw] = dateFrom.split("-").map(Number);
  const startYear = Number.isFinite(startYearRaw) ? startYearRaw : targetYear;
  const startMonth = Number.isFinite(startMonthRaw) ? startMonthRaw : 1;
  const all: any[] = [];

  for (
    let cursor = { year: startYear, month: startMonth };
    cursor.year < targetYear || (cursor.year === targetYear && cursor.month <= targetMonth);
    cursor = addMonths(cursor.year, cursor.month)
  ) {
    const monthStart = formatMonthDate(cursor.year, cursor.month, 1);
    const monthEnd = formatMonthDate(
      cursor.year,
      cursor.month,
      new Date(cursor.year, cursor.month, 0).getDate(),
    );
    const from = monthStart < dateFrom ? dateFrom : monthStart;
    const to = monthEnd > dateTo ? dateTo : monthEnd;
    if (from > dateTo) break;

    try {
      const part = await fetchAllStorageTransactions({
        companyId,
        date_from: from,
        date_to: to,
      });
      all.push(...part);
    } catch (err) {
      console.warn(
        `[altegio/inventory] Не вдалося отримати складські транзакції ${from}…${to} для історичного балансу:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const byId = new Map<string, any>();
  let anonymousIndex = 0;
  for (const t of all) {
    const key = getStorageTransactionRowKey(t, anonymousIndex++);
    byId.set(key, t);
  }

  console.log(
    `[altegio/inventory] Складські транзакції ${dateFrom}…${dateTo}: ${byId.size} унікальних (сирих ${all.length})`,
  );

  return [...byId.values()];
}

function unwrapSingleGood(raw: any): any | null {
  const payload = unwrapAltegioPayload<any>(raw);
  if (Array.isArray(payload)) {
    return payload[0] ?? null;
  }
  return payload && typeof payload === "object" ? payload : null;
}

async function fetchGoodsCardsByIds(
  companyId: string,
  productIds: number[],
): Promise<Map<number, any>> {
  const goodsById = new Map<number, any>();
  const uniqueIds = Array.from(new Set(productIds.filter((id) => Number.isFinite(id) && id > 0)));
  const batchSize = 10;

  console.log(
    `[altegio/inventory] 🔍 Отримуємо детальні картки товарів через /goods/${companyId}/{product_id}: ${uniqueIds.length} шт.`,
  );

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (productId) => {
        try {
          const path = `/goods/${companyId}/${productId}`;
          const raw = await altegioFetch<any>(path);
          const good = unwrapSingleGood(raw);
          if (!good) {
            return null;
          }

          const goodId = Number(good?.good_id || good?.id || productId);
          return goodId > 0 ? { goodId, good } : null;
        } catch (err: any) {
          console.log(
            `[altegio/inventory] ⚠️ Не вдалося отримати картку товару ${productId}:`,
            err?.message || String(err),
          );
          return null;
        }
      }),
    );

    for (const result of results) {
      if (result) {
        goodsById.set(result.goodId, result.good);
      }
    }

    if (i + batchSize < uniqueIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  console.log(
    `[altegio/inventory] ✅ Отримано детальних карток товарів: ${goodsById.size}/${uniqueIds.length}`,
  );

  return goodsById;
}

/** Витяг cost_price з відповіді V2 (плоский data або JSON:API attributes). */
function extractV2ProductCostPriceUah(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const direct = Number(d.cost_price);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const attrs = d.attributes;
  if (attrs && typeof attrs === "object") {
    const a = Number((attrs as Record<string, unknown>).cost_price);
    if (Number.isFinite(a) && a > 0) return a;
  }
  return null;
}

/**
 * Altegio V2: GET /locations/{location_id}/products/{product_id} → cost_price (собівартість за одиницю).
 * Викликається для **усіх** карток у мапі: V1 часто дає `actual_cost`/`unit_actual`, які не підходять для Σ(amount×ціна),
 * тому раніше V2 пропускався і goods_card лишався 0.
 */
async function enrichGoodsCardsWithV2CostPrice(
  locationId: string,
  goodsById: Map<number, any>,
): Promise<{ attempted: number; enriched: number; v2HttpErrors: number }> {
  let enriched = 0;
  let v2HttpErrors = 0;
  let firstV2ErrExample: string | undefined;
  const batchSize = 10;

  const entries = [...goodsById.entries()].filter(([goodId]) => goodId > 0);
  if (entries.length === 0) {
    console.log(`[altegio/inventory] V2 cost_price: немає good_id у мапі карток — пропуск`);
    return { attempted: 0, enriched: 0, v2HttpErrors: 0 };
  }

  console.log(
    `[altegio/inventory] 🔍 V2 GET /locations/${locationId}/products/{id} для cost_price: ${entries.length} товарів (база b2b-v2: ${process.env.ALTEGIO_API_URL_V2?.trim() || "з ALTEGIO_API_URL → …/api/v2"})`,
  );

  for (let i = 0; i < entries.length; i += batchSize) {
    const slice = entries.slice(i, i + batchSize);
    const outcomes = await Promise.all(
      slice.map(async ([goodId, g]): Promise<"ok" | "empty" | "http_err"> => {
        try {
          const raw = await altegioFetch<any>(
            `/locations/${locationId}/products/${goodId}`,
            {},
            5,
            350,
            45000,
            altegioUrlV2,
          );
          const payload = unwrapAltegioPayload<any>(raw) || raw;
          const data =
            payload && typeof payload === "object" && payload.data != null && typeof payload.data === "object"
              ? payload.data
              : payload;
          const cp = extractV2ProductCostPriceUah(data);
          if (cp != null && cp > 0) {
            (g as any).cost_price = cp;
            return "ok";
          }
        } catch (err: any) {
          firstV2ErrExample ??= err?.message || String(err);
          if (process.env.DEBUG_ALTEGIO === "1") {
            console.log(`[altegio/inventory] V2 product ${goodId}:`, err?.message || String(err));
          }
          return "http_err";
        }
        return "empty";
      }),
    );
    enriched += outcomes.filter((o) => o === "ok").length;
    v2HttpErrors += outcomes.filter((o) => o === "http_err").length;
    if (i + batchSize < entries.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const attempted = entries.length;

  console.log(
    `[altegio/inventory] ✅ V2 cost_price: збагачено ${enriched}/${attempted} карток (помилок HTTP: ${v2HttpErrors}, у мапі ${goodsById.size})`,
  );

  if (enriched === 0 && attempted > 0) {
    console.warn(
      `[altegio/inventory] ⚠️ V2 cost_price: жодного успіху з ${attempted} запитів${firstV2ErrExample ? ` — приклад: ${firstV2ErrExample}` : ""}. Перевір endpoint /locations/${locationId}/products/{id} та права токена (Accept: v2+json у клієнті).`,
    );
  }

  return { attempted, enriched, v2HttpErrors };
}

/** Див. `docs/finance-cogs-altegio.md` — знак `amount` у продажах, порядок кандидатів COGS, `[COGS_SUMMARY]`. */
function calculateCostFromGoodsCards(
  sales: any[],
  goodsById: Map<number, any>,
): {
  totalCost: number;
  matchedGoods: number;
  matchedItems: number;
  goodsList: SoldGoodItem[];
  unmatchedGoods: Array<{ goodId?: number; title: string; quantity: number }>;
} {
  const goodsMap = new Map<number | string, SoldGoodItem>();
  const unmatchedGoods: Array<{ goodId?: number; title: string; quantity: number }> = [];
  let totalCost = 0;
  let matchedGoods = 0;
  let matchedItems = 0;

  for (const sale of sales) {
    const goodId = Number(sale?.good_id || sale?.good?.id || 0);
    const rawAmt = Number(sale?.amount);
    if (!Number.isFinite(rawAmt) || rawAmt === 0) continue;

    const title =
      sale?.good?.title ||
      sale?.good?.name ||
      `Товар #${goodId || sale?.id || "N/A"}`;

    const key = goodId || title;
    const existing = goodsMap.get(key);
    if (existing) {
      /** Підписана кількість: повернення (від’ємний amount) зменшують нетто */
      existing.quantity += rawAmt;
      continue;
    }

    goodsMap.set(key, {
      goodId: goodId || undefined,
      title,
      quantity: rawAmt,
      costPerUnit: 0,
      totalCost: 0,
    });
  }

  const goodsList = Array.from(goodsMap.values());

  for (const item of goodsList) {
    const goodCard = item.goodId ? goodsById.get(item.goodId) : null;
    const costPerUnit = getGoodCardCostPerUnit(goodCard);
    const netQty = item.quantity;
    const absNet = Math.abs(netQty);
    if (costPerUnit > 0 && absNet > 0) {
      item.costPerUnit = costPerUnit;
      // У goods_transactions amount < 0 = продаж (списання). COGS у звіті — додатна сума: -costPerUnit * netQty.
      item.totalCost = -costPerUnit * netQty;
      totalCost += item.totalCost;
      matchedGoods += 1;
      matchedItems += absNet;
    } else if (absNet > 0) {
      unmatchedGoods.push({
        goodId: item.goodId,
        title: item.title,
        quantity: absNet,
      });
    }
  }

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    matchedGoods,
    matchedItems,
    goodsList,
    unmatchedGoods,
  };
}

/**
 * Загальний баланс складу + залишки по складах (останній знімок з API товарів на дату для транзакційного fallback).
 * Згідно з документацією: https://developer.alteg.io/api#tag/Inventory
 */
export async function getWarehouseBalanceDetailed(params: {
  date: string;
}): Promise<WarehouseBalanceDetailedResult> {
  const { date } = params;
  const companyId = resolveCompanyId();

  try {
    console.log(
      `[altegio/inventory] Fetching warehouse balance (detailed) for date ${date} using GET /goods/${companyId}`,
    );

    let goods = await fetchGoodsListForWarehouseBalance(companyId);
    goods = await enrichWarehouseGoodsForBalance(companyId, goods);

    if (goods.length === 0) {
      console.log(`[altegio/inventory] ⚠️ No goods found from direct API, calculating balance from transactions...`);
      return getWarehouseBalanceFromTransactionsDetailed(companyId, date, goods);
    }

    const todayKyiv = getKyivIsoDateOnly();
    if (date < todayKyiv) {
      console.log(
        `[altegio/inventory] Дата ${date} вже минула (сьогодні ${todayKyiv}); для snapshot відмотуємо поточний склад назад рухами після дати`,
      );
      const rewound = await getWarehouseBalanceByRewindingCurrentStock(companyId, date, goods);
      if (rewound.total > 0) {
        return rewound;
      }
      const forward = await getWarehouseBalanceFromTransactionsDetailed(companyId, date, goods);
      throw new Error(
        `Реконструкція складу на ${date} дала ${rewound.total} методом current-minus-after і ${forward.total} методом from-zero; не перезаписуємо snapshot поточними /goods actual_amounts`,
      );
    }

    const total = computeTotalWarehouseBalanceFromGoods(goods);
    const byStorage = computePerStorageBalancesFromGoods(goods);
    const storages = mapToWarehouseStorageRows(byStorage);
    const diagnostics = buildWarehouseBalanceDiagnostics(goods, roundMoney2(total));

    let goodsWithStock = 0;
    let goodsWithoutStock = 0;
    for (const good of goods) {
      const cpu = getWarehouseStockValuationUnitPrice(good);
      if (cpu <= 0) {
        goodsWithoutStock++;
        continue;
      }
      const totalQuantity = getWarehouseGoodReportQuantity(good);
      if (totalQuantity > 0 && cpu > 0) goodsWithStock++;
      else goodsWithoutStock++;
    }

    console.log(`[altegio/inventory] ✅ Warehouse balance on ${date}: ${total} UAH`);
    console.log(`[altegio/inventory]   - Goods with stock: ${goodsWithStock}`);
    console.log(`[altegio/inventory]   - Goods without stock/cost: ${goodsWithoutStock}`);
    console.log(`[altegio/inventory]   - Storages in breakdown: ${storages.length}`);

    return { total, storages, source: "goods_current_actual_amounts", diagnostics };
  } catch (error: any) {
    console.error(`[altegio/inventory] ❌ Failed to get warehouse balance:`, error?.message || String(error));
    if (date < getKyivIsoDateOnly()) {
      throw error;
    }
    return { total: 0, storages: [], source: "goods_current_actual_amounts" };
  }
}

/**
 * Отримати баланс складу на конкретну дату (сума в грн).
 */
export async function getWarehouseBalance(params: { date: string }): Promise<number> {
  const { total } = await getWarehouseBalanceDetailed(params);
  return total;
}


/**
 * Отримати агреговану виручку / собівартість / націнку по товарах із inventory transactions за період.
 *
 * Використовуємо `/storages/transactions/{locationId}` для отримання транзакцій продажу.
 * Собівартість беремо з `GET /storage_operations/goods_transactions/{location_id}/{transaction_id}`
 * через поле `data.good.actual_cost`. Якщо API не повернув значення, використовуємо ручний fallback.
 *
 * Припущення:
 * - `cost` у транзакції продажу = виручка по товару (Total cost у звіті)
 * - Пріоритет: `actual_cost` з goods_transactions
 * - Fallback: ручно збережена собівартість з KV
 * - `amount` = кількість проданих одиниць (може бути від'ємним для повернень)
 *
 * Тоді:
 *   revenue = Σ |cost| (для type_id = 1)
 *   cost    = Σ actual_cost по транзакціях продажу (fallback: manual / legacy)
 *   profit  = revenue - cost
 */
export async function fetchGoodsSalesSummary(params: {
  date_from: string;
  date_to: string;
  /** Виручка рядка «Товари» з fetchFinanceSummary — для cap COGS (узгоджено з екраном звіту, не лише склад) */
  salonGoodsRevenueUah?: number;
  /** Додаткові поля income_goods_stats з fetchFinanceSummary — інколи там окрема сума собівартості */
  incomeGoodsStatsExtras?: Record<string, unknown>;
}): Promise<GoodsSalesSummary> {
  const { date_from, date_to, salonGoodsRevenueUah, incomeGoodsStatsExtras } = params;
  const companyId = resolveCompanyId();

  // Перевіряємо, чи є збережене значення собівартості для цього періоду
  // Використовуємо динамічний імпорт, щоб уникнути проблем з server components
  let manualCost: number | null = null;
  try {
    const dateFrom = new Date(date_from);
    const year = dateFrom.getFullYear();
    const month = dateFrom.getMonth() + 1;

    const costKey = `finance:goods:cost:${year}:${month}`;
    console.log(`[altegio/inventory] Checking for manual cost: key=${costKey}, year=${year}, month=${month}`);
    
    // Динамічний імпорт для уникнення проблем з server components
    const kvModule = await import("@/lib/kv");
    const kvReadModule = kvModule.kvRead;
    
    if (kvReadModule && typeof kvReadModule.getRaw === "function") {
      const rawValue = await kvReadModule.getRaw(costKey);
      console.log(`[altegio/inventory] KV read result for ${costKey}:`, {
        hasValue: rawValue !== null,
        valueType: typeof rawValue,
        valuePreview: rawValue ? String(rawValue).slice(0, 100) : null,
      });
      
      if (rawValue !== null && typeof rawValue === "string") {
        // kvGetRaw може повертати {"value":"..."} або просто "..."
        // Потрібно витягти значення з об'єкта, якщо воно там є
        let costValue: number | null = null;
        try {
          // Спробуємо розпарсити як JSON
          const parsed = JSON.parse(rawValue);
          console.log(`[altegio/inventory] Parsed JSON:`, { parsed, type: typeof parsed });
          
          if (typeof parsed === "number") {
            costValue = parsed;
          } else if (typeof parsed === "object" && parsed !== null) {
            // Якщо це об'єкт, шукаємо value всередині
            const value = (parsed as any).value ?? parsed;
            if (typeof value === "number") {
              costValue = value;
            } else if (typeof value === "string") {
              costValue = parseFloat(value);
            } else {
              costValue = parseFloat(String(value));
            }
          } else if (typeof parsed === "string") {
            costValue = parseFloat(parsed);
          } else {
            costValue = parseFloat(String(parsed));
          }
        } catch {
          // Якщо не JSON, пробуємо як число
          console.log(`[altegio/inventory] Not JSON, trying parseFloat:`, rawValue);
          costValue = parseFloat(rawValue);
        }
        
        console.log(`[altegio/inventory] Parsed cost value:`, {
          costValue,
          isFinite: Number.isFinite(costValue),
          isNonNegative: costValue !== null && costValue >= 0,
        });
        
        if (costValue !== null && Number.isFinite(costValue) && costValue >= 0) {
          manualCost = costValue;
          console.log(
            `[altegio/inventory] ✅ Using manual cost for ${year}-${month}: ${manualCost}`,
          );
        } else {
          console.log(
            `[altegio/inventory] ⚠️ Invalid cost value: ${costValue} (not finite or negative)`,
          );
        }
      } else {
        console.log(
          `[altegio/inventory] ⚠️ No raw value found or wrong type for ${costKey}`,
        );
      }
    } else {
      console.warn(`[altegio/inventory] ⚠️ kvReadModule.getRaw is not a function`);
    }
  } catch (err: any) {
    // Логуємо помилки для діагностики
    console.error(
      `[altegio/inventory] ❌ Failed to check manual cost:`,
      err?.message || String(err),
      err?.stack,
    );
  }

  const tx = await fetchAllStorageTransactions({
    companyId,
    date_from,
    date_to,
  });

  console.log(
    `[altegio/inventory] Fetched ${tx.length} transactions`,
  );

  // Детальне логування структури транзакцій для діагностики собівартості
  if (tx.length > 0) {
    const sampleTx = tx[0];
    console.log(`[altegio/inventory] Sample transaction structure:`, {
      id: sampleTx.id,
      type_id: sampleTx.type_id,
      amount: sampleTx.amount,
      cost: sampleTx.cost,
      cost_per_unit: sampleTx.cost_per_unit,
      allKeys: Object.keys(sampleTx),
      // Шукаємо поля, що можуть містити собівартість
      possibleCostFields: Object.keys(sampleTx).filter(key => 
        key.toLowerCase().includes('cost') || 
        key.toLowerCase().includes('price') ||
        key.toLowerCase().includes('purchase') ||
        key.toLowerCase().includes('wholesale') ||
        key.toLowerCase().includes('buy')
      ),
    });
    
    // Логуємо всі поля першої транзакції для повного розуміння структури
    console.log(`[altegio/inventory] Full sample transaction:`, JSON.stringify(sampleTx, null, 2).substring(0, 2000));
  }

  // type_id = 1 — продаж товарів (Sale of goods)
  // type_id = 2 — закупівля (Purchase of goods)
  // type_id = 3 — прийомка / надходження (Product receipt / incoming), див. Altegio KB та GET /storages/transactions
  logStorageTransactionTypeSummary(tx, `${date_from}…${date_to}`);

  const sales = tx.filter((t) => Number(t.type_id) === 1);
  const purchasesType2 = tx.filter((t) => Number(t.type_id) === 2);
  const receiptsType3 = tx.filter((t) => Number(t.type_id) === 3);
  const writeOffs = tx.filter(isStorageWriteoffTransaction);
  /** Усі надходження на склад за період (для Σ вартості та fallback «остання закупівля») */
  const purchases = [...purchasesType2, ...receiptsType3];

  const otherStorageTx = tx.filter((t) => {
    const tid = Number(t.type_id);
    return (
      Number.isFinite(tid) &&
      tid !== 1 &&
      tid !== 2 &&
      tid !== 3 &&
      !isStorageWriteoffTransaction(t)
    );
  });
  if (otherStorageTx.length > 0) {
    console.log(
      `[altegio/inventory] ℹ️ Транзакції складу поза sale(1)/purchase(2)/receipt(3) і без евристики списання: ${otherStorageTx.length}. Приклади:`,
      JSON.stringify(
        otherStorageTx.slice(0, 5).map((t) => ({
          id: t.id,
          type_id: t.type_id,
          type: t.type,
          amount: t.amount,
        })),
      ),
    );
  }

  console.log(
    `[altegio/inventory] filtered sales (type_id=1): ${sales.length}; inbound type2=${purchasesType2.length}, receipts type3=${receiptsType3.length}; write-offs≈${writeOffs.length}`,
  );

  await enrichSalesWithDocumentIdsFromGoodsTransactions(companyId, sales);
  
  if (purchasesType2.length > 0) {
    const samplePurchase = purchasesType2[0];
    console.log(`[altegio/inventory] Sample inbound transaction (type_id=2):`, {
      id: samplePurchase.id,
      type_id: samplePurchase.type_id,
      type: samplePurchase.type,
      amount: samplePurchase.amount,
      cost: samplePurchase.cost,
      cost_per_unit: samplePurchase.cost_per_unit,
    });
  }
  if (receiptsType3.length > 0) {
    const sampleR = receiptsType3[0];
    console.log(`[altegio/inventory] Sample receipt transaction (type_id=3):`, {
      id: sampleR.id,
      type_id: sampleR.type_id,
      type: sampleR.type,
      amount: sampleR.amount,
      cost: sampleR.cost,
      cost_per_unit: sampleR.cost_per_unit,
      storage: sampleR.storage,
    });
  }

  // Розраховуємо виручку: використовуємо cost (загальна сума транзакції), якщо він є
  // Якщо cost = 0, тоді використовуємо cost_per_unit * amount
  // Для продажів amount зазвичай від'ємний (зменшення складу), тому беремо абсолютне значення
  const revenue = sales.reduce(
    (sum, t) => {
      const transactionCost = Math.abs(Number(t.cost) || 0);
      if (transactionCost > 0) {
        // Використовуємо cost (загальна сума), якщо він є
        return sum + transactionCost;
      } else {
        // Fallback: cost_per_unit * amount
        const amount = Math.abs(Number(t.amount) || 0);
        const costPerUnit = Number(t.cost_per_unit) || 0;
        return sum + amount * costPerUnit;
      }
    },
    0,
  );

  /** Для cap «собівартість не розходиться з виручкою по товарах»: пріоритет — рядок «Товари» з аналітики (як у фінзвіті) */
  const capBaseForGoodsCost =
    typeof salonGoodsRevenueUah === "number" && salonGoodsRevenueUah > 0
      ? salonGoodsRevenueUah
      : revenue;
  console.log(
    `[altegio/inventory] Перевірка COGS vs виручка: capBase=${capBaseForGoodsCost} (${
      salonGoodsRevenueUah && salonGoodsRevenueUah > 0
        ? "totals.goods з analytics"
        : "Σ склад type_id=1"
    })`,
  );

  // Спочатку рахуємо загальну кількість проданих одиниць товару з транзакцій складу
  // (це буде fallback, якщо не вдасться отримати дані з документів продажу)
  const totalItemsSoldFromTransactions = sales.reduce(
    (sum, t) => {
      const amount = Math.abs(Number(t.amount) || 0);
      return sum + amount;
    },
    0,
  );
  
  // Детальне логування для діагностики
  console.log(`[altegio/inventory] 📊 Sales transactions analysis:`);
  console.log(`  - Total sales transactions: ${sales.length}`);
  console.log(`  - Total items sold (sum of amounts from transactions): ${totalItemsSoldFromTransactions}`);
  
  // Логуємо деталі перших кількох транзакцій
  if (sales.length > 0) {
    const sampleSales = sales.slice(0, 5).map(t => ({
      id: t.id,
      amount: t.amount,
      amount_abs: Math.abs(Number(t.amount) || 0),
      good_id: t.good_id,
      good_title: t.good?.title || 'N/A',
    }));
    console.log(`[altegio/inventory] Sample sales transactions:`, JSON.stringify(sampleSales, null, 2));
  }
  
  // Загальна кількість проданих одиниць товару
  // Буде оновлено при отриманні документів продажу
  let totalItemsSold = totalItemsSoldFromTransactions;

  // Спробуємо обчислити собівартість з різних джерел
  let calculatedCost: number | null = null;
  /** Σ з документів продажу (manual → default → first — як у pickSaleDocumentLineCostTotalForGood) */
  let saleDocumentsCostSum: number | null = null;
  /** Σ лише first_cost / first_cost_total по тих самих документах — часто ближче до рядка собівартості в «Аналізі продажів» */
  let saleDocumentsFirstBasisSum: number | null = null;
  /** Blended сума з документів до cap — потрібна для sale_document_first, коли saleDocumentsCostSum обнулено через cap */
  let saleDocumentsBlendedSumRejectedByCap: number | null = null;
  let costItemsCount: number = 0; // Загальна кількість одиниць товару, по яких розраховано собівартість
  let costTransactionsCount: number = 0; // Лічильник для goods_card / fallback; для actual та sale — див. resolvedCostTransactionsCount
  /** Документів продажу з cost>0 після завантаження /sale/{id} (без змішування з actual 41/42) */
  let saleDocumentLoadsWithCost = 0;
  let actualCostFromGoodsTransactions: number | null = null;
  /** Скільки складських продажів дали ненульовий actual_cost (для порогу покриття) */
  let actualCostSuccessfulTxn = 0;
  let goodsCardCost: number | null = null;
  let goodsCardGoodsList: SoldGoodItem[] | null = null;
  
  // Варіант 1: Собівартість проданого товару напряму з goods_transactions.actual_cost
  if (sales.length > 0) {
    try {
      const actualCostResult = await fetchActualCostForSalesTransactions(companyId, sales);
      if (actualCostResult.successfulTransactions > 0) {
        actualCostFromGoodsTransactions = actualCostResult.totalCost;
        actualCostSuccessfulTxn = actualCostResult.successfulTransactions;
      }
    } catch (err: any) {
      console.warn(
        `[altegio/inventory] ⚠️ Не вдалося порахувати actual_cost через goods_transactions:`,
        err?.message || String(err),
      );
    }
  }

  // Варіант 2: З sale document (`data.state.items[].default_cost_total`) — fallback
  let allSaleDocumentResults: Array<{ cost: number; firstBasis?: number; amount: number; itemsCount: number }> = [];
  const goodsMap = new Map<number | string, SoldGoodItem>(); // good_id або title -> товар
  
  if (sales.length > 0) {
    try {
      console.log(`[altegio/inventory] 🔍 Fetching sale documents to get default_cost_total...`);
      
      let costFromSaleDocuments = 0;
      let costFromSaleDocumentsFirstBasis = 0;
      let successfulFetches = 0;
      let failedFetches = 0;
      const processedDocumentIds = new Set<number>();
      const uniqueDocumentSales = sales.filter((sale) => {
        const documentId = getStorageSaleDocumentIdForFetch(sale);
        if (!documentId) return false;
        if (processedDocumentIds.has(documentId)) return false;
        processedDocumentIds.add(documentId);
        return true;
      });

      console.log(
        `[altegio/inventory] 📄 Унікальних sale documents: ${uniqueDocumentSales.length} з ${sales.length} складських транзакцій`,
      );
      
      const batchSize = 10;
      for (let i = 0; i < uniqueDocumentSales.length; i += batchSize) {
        const batch = uniqueDocumentSales.slice(i, i + batchSize);
        
        const batchPromises = batch.map(
          async (
            sale,
          ): Promise<{
            cost: number;
            firstBasis: number;
            amount: number;
            itemsCount: number;
          } | null> => {
          const documentId = getStorageSaleDocumentIdForFetch(sale);
          if (!documentId) {
            return null;
          }
          
          try {
            const saleDocumentPath = `/company/${companyId}/sale/${documentId}`;
            const saleDocument = await altegioFetch<any>(saleDocumentPath);
            const extracted = extractSaleDocumentGoods(saleDocument, sale);
            mergeGoodsIntoMap(goodsMap, extracted.goods);

            if (successfulFetches < 3) {
              console.log(
                `[altegio/inventory] 📄 Sale document ${documentId}: items=${extracted.itemsCount}, goods=${extracted.goods.length}, cost=${extracted.totalCost}`,
              );
            }

            if (extracted.itemsCount > 0 || extracted.totalCost > 0) {
              return {
                cost: extracted.totalCost,
                firstBasis: extracted.totalFirstBasisCost,
                amount: extracted.itemsCount,
                itemsCount: extracted.itemsCount,
              };
            }

            return null;
          } catch (err: any) {
            console.log(`[altegio/inventory] ⚠️ Failed to fetch sale document ${documentId}:`, err?.message || String(err));
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter(
          (
            result,
          ): result is {
            cost: number;
            firstBasis: number;
            amount: number;
            itemsCount: number;
          } => result !== null && typeof result === "object" && "itemsCount" in result,
        );

        allSaleDocumentResults.push(...validResults);

        costFromSaleDocuments += validResults.reduce((sum, result) => sum + result.cost, 0);
        costFromSaleDocumentsFirstBasis += validResults.reduce(
          (sum, result) => sum + (Number(result.firstBasis) || 0),
          0,
        );
        costItemsCount += validResults.reduce((sum, result) => sum + result.amount, 0);
        saleDocumentLoadsWithCost += validResults.filter((result) => result.cost > 0).length;

        const failedDocuments = batch.filter((sale, idx) => batchResults[idx] === null);
        for (const sale of failedDocuments) {
          const amount = Math.abs(Number(sale.amount) || 0);
          if (amount > 0) {
            const goodId = sale.good_id;
            const title = sale.good?.title || sale.good?.name || `Товар #${goodId || sale.id || 'N/A'}`;
            const key = goodId || title;
            const existing = goodsMap.get(key);
            
            if (existing) {
              existing.quantity += amount;
              existing.totalCost = existing.costPerUnit * existing.quantity;
            } else {
              goodsMap.set(key, {
                goodId: goodId,
                title: title,
                quantity: amount,
                costPerUnit: 0, // Не знаємо собівартість, бо документ не отримано
                totalCost: 0,
              });
            }
            
            allSaleDocumentResults.push({ cost: 0, firstBasis: 0, amount: amount, itemsCount: amount });
          }
        }
        
        successfulFetches += validResults.length;
        failedFetches += batchResults.length - validResults.length;
        
        if (i + batchSize < uniqueDocumentSales.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Рахуємо загальну кількість проданих одиниць товару з усіх документів (навіть без собівартості)
      if (allSaleDocumentResults.length > 0) {
        totalItemsSold = allSaleDocumentResults.reduce((sum, result) => sum + result.itemsCount, 0);
        console.log(`[altegio/inventory] 📦 Total items sold from sale documents: ${totalItemsSold} (from ${allSaleDocumentResults.length} documents, fallback was ${totalItemsSoldFromTransactions})`);
      } else {
        console.log(`[altegio/inventory] ⚠️ No sale documents retrieved, using fallback: ${totalItemsSoldFromTransactions} items from transactions`);
      }
      
      // Якщо не зібрали товари з документів, збираємо з транзакцій складу
      if (goodsMap.size === 0 && sales.length > 0) {
        console.log(`[altegio/inventory] ⚠️ No goods collected from sale documents, collecting from storage transactions...`);
        for (const sale of sales) {
          const amount = Math.abs(Number(sale.amount) || 0);
          if (amount > 0) {
            const goodId = sale.good_id;
            const title = sale.good?.title || sale.good?.name || `Товар #${goodId || sale.id || 'N/A'}`;
            const key = goodId || title;
            const existing = goodsMap.get(key);
            
            if (existing) {
              existing.quantity += amount;
              existing.totalCost = existing.costPerUnit * existing.quantity;
            } else {
              goodsMap.set(key, {
                goodId: goodId,
                title: title,
                quantity: amount,
                costPerUnit: 0, // Не знаємо собівартість з транзакцій складу
                totalCost: 0,
              });
            }
          }
        }
        console.log(`[altegio/inventory] 📦 Collected ${goodsMap.size} goods from storage transactions`);
      }
      
      if (costFromSaleDocuments > 0) {
        saleDocumentsCostSum = costFromSaleDocuments;
        calculatedCost = costFromSaleDocuments;
        const roundedFirst = Math.round(Math.max(0, costFromSaleDocumentsFirstBasis) * 100) / 100;
        if (roundedFirst > 0) {
          saleDocumentsFirstBasisSum = roundedFirst;
        }
        console.log(
          `[altegio/inventory] 📄 Паралельно «вузька» собівартість по документах (first/prime/purchase поля, без manual/default): ${roundedFirst} грн; blended з документів: ${saleDocumentsCostSum} грн; документів з cost>0: ${saleDocumentLoadsWithCost}/${uniqueDocumentSales.length}`,
        );
        console.log(
          `[altegio/inventory] ✅ Calculated cost from sale documents (blended): ${calculatedCost} (items: ${costItemsCount}, failed: ${failedFetches})`,
        );
        if (failedFetches > 0) {
          console.warn(
            `[altegio/inventory] ⚠️ Частина документів продажу не завантажилась (${failedFetches}) — сума з документів може бути занижена; звіряйте з кабінетом Altegio.`,
          );
        }
      } else {
        console.log(`[altegio/inventory] ⚠️ No cost found from sale documents (successful: ${successfulFetches}, failed: ${failedFetches})`);
      }
    } catch (err: any) {
      console.warn(`[altegio/inventory] ⚠️ Failed to fetch cost from sale documents:`, err?.message || String(err));
    }
  }

  if (sales.length > 0 && (saleDocumentsCostSum === null || saleDocumentsCostSum <= 0) && goodsMap.size > 0) {
    const fromMapRaw = Array.from(goodsMap.values()).reduce(
      (acc, item) => acc + (Number(item.totalCost) || 0),
      0,
    );
    const rounded = Math.round(Math.max(0, fromMapRaw) * 100) / 100;
    const revenueCap = Math.round(capBaseForGoodsCost * 1.05 * 100) / 100;
    const withinRevenueCap = capBaseForGoodsCost <= 0 || rounded <= revenueCap;
    if (rounded > 0 && withinRevenueCap) {
      saleDocumentsCostSum = rounded;
      if (calculatedCost === null || calculatedCost <= 0) {
        calculatedCost = rounded;
      }
      console.log(
        `[altegio/inventory] ✅ saleDocumentsCostSum відновлено з goodsMap (Σ totalCost, з урахуванням знаку рядків): ${saleDocumentsCostSum}`,
      );
    } else if (rounded > 0 && !withinRevenueCap) {
      console.warn(
        `[altegio/inventory] ⚠️ Σ з goodsMap (${rounded}) перевищує capBase×1.05 (${revenueCap}, capBase=${capBaseForGoodsCost}); не підставляємо як saleDocumentsCostSum`,
      );
    }
  }

  // Варіант 0: Для кожного проданого good_id — V1 GET /goods/{loc}/{id}, потім V2 GET /locations/{loc}/products/{id} (cost_price),
  // далі Σ(amount зі складу type_id=1) × собівартість за одиницю. У фінальному виборі goods_card перед actual_cost (див. costCandidates).
  if (sales.length > 0) {
    try {
      const soldProductIds = sales
        .map((sale) => Number(sale?.good_id || sale?.good?.id || 0))
        .filter((id) => id > 0);
      const goodsById = await fetchGoodsCardsByIds(companyId, soldProductIds);
      const v2EnrichMeta = await enrichGoodsCardsWithV2CostPrice(companyId, goodsById);
      const goodsCardResult = calculateCostFromGoodsCards(sales, goodsById);
      const goodsCardRounded = Math.round(Math.max(0, goodsCardResult.totalCost) * 100) / 100;
      if (goodsCardResult.matchedGoods > 0 && goodsCardRounded > 0) {
        goodsCardCost = goodsCardRounded;
        goodsCardGoodsList = goodsCardResult.goodsList;
        // Не перезаписуємо лічильники документів продажу, якщо з них уже є сума (sale_documents має пріоритет)
        if (saleDocumentsCostSum === null || saleDocumentsCostSum <= 0) {
          costTransactionsCount = goodsCardResult.matchedGoods;
          costItemsCount = goodsCardResult.matchedItems;
        }
        console.log(
          `[altegio/inventory] ✅ Собівартість по картках товарів: ${goodsCardCost} (goods: ${goodsCardResult.matchedGoods}, items: ${goodsCardResult.matchedItems}; V2 cost_price: ${v2EnrichMeta.enriched}/${v2EnrichMeta.attempted}, помилок V2: ${v2EnrichMeta.v2HttpErrors})`,
        );
        if (goodsCardResult.unmatchedGoods.length > 0) {
          console.log(
            `[altegio/inventory] ⚠️ Товари без собівартості в картці: ${goodsCardResult.unmatchedGoods.length}`,
            JSON.stringify(goodsCardResult.unmatchedGoods.slice(0, 10), null, 2),
          );
        }
      } else {
        console.log(
          `[altegio/inventory] ⚠️ Не вдалося порахувати собівартість з карток товарів (V2: ${v2EnrichMeta.enriched}/${v2EnrichMeta.attempted}, помилок: ${v2EnrichMeta.v2HttpErrors}; matchedGoods=${goodsCardResult.matchedGoods}, totalCost=${goodsCardResult.totalCost})`,
        );
        if (goodsCardResult.unmatchedGoods.length > 0) {
          console.log(
            `[altegio/inventory] ⚠️ Товари без ціни за одиницю (перші 12):`,
            JSON.stringify(goodsCardResult.unmatchedGoods.slice(0, 12), null, 0),
          );
        }
      }
    } catch (err: any) {
      console.warn(
        `[altegio/inventory] ⚠️ Помилка розрахунку собівартості з карток товарів:`,
        err?.message || String(err),
      );
    }
  }
  
  // Варіант 1: З транзакцій надходження на склад (type_id=2 та 3) — FALLBACK
  // Можливо, cost_per_unit або cost в транзакціях закупки містить собівартість
  if (calculatedCost === null && purchases.length > 0) {
    const purchaseCost = purchases.reduce((sum, t) => {
      // Для закупки cost_per_unit може бути оптовою ціною (собівартістю)
      const costPerUnit = Number(t.cost_per_unit) || 0;
      const amount = Math.abs(Number(t.amount) || 0);
      if (costPerUnit > 0 && amount > 0) {
        return sum + (costPerUnit * amount);
      }
      // Або cost може містити загальну суму закупки
      const totalCost = Math.abs(Number(t.cost) || 0);
      if (totalCost > 0) {
        return sum + totalCost;
      }
      return sum;
    }, 0);
    
    if (purchaseCost > 0) {
      calculatedCost = purchaseCost;
      console.log(`[altegio/inventory] ✅ Calculated cost from purchase transactions: ${calculatedCost}`);
    }
  }
  
  // Варіант 2: З транзакцій продажу (type_id=1)
  // Можливо, cost_per_unit в транзакціях продажу містить оптову ціну (собівартість)
  // Або є окреме поле для оптової ціни
  if (calculatedCost === null && sales.length > 0) {
    // Перевіряємо, чи є в транзакціях продажу поля, що можуть містити собівартість
    const sampleSale = sales[0];
    const allKeys = Object.keys(sampleSale);
    console.log(`[altegio/inventory] All keys in sales transaction:`, allKeys);
    
    const possibleCostFields = allKeys.filter(key => 
      key.toLowerCase().includes('wholesale') || 
      key.toLowerCase().includes('purchase') ||
      key.toLowerCase().includes('buy') ||
      (key.toLowerCase().includes('cost') && !key.toLowerCase().includes('per') && !key.toLowerCase().includes('total'))
    );
    
    if (possibleCostFields.length > 0) {
      console.log(`[altegio/inventory] Found possible cost fields in sales:`, possibleCostFields);
      // Спробуємо обчислити собівартість з цих полів
      const costFromSales = sales.reduce((sum, t) => {
        for (const field of possibleCostFields) {
          const value = Number((t as any)[field]) || 0;
          if (value > 0) {
            // Якщо це поле на одиницю, множимо на amount
            const amount = Math.abs(Number(t.amount) || 0);
            if (field.toLowerCase().includes('per') || field.toLowerCase().includes('unit')) {
              return sum + (value * amount);
            }
            // Інакше це загальна сума
            return sum + Math.abs(value);
          }
        }
        return sum;
      }, 0);
      
      if (costFromSales > 0) {
        calculatedCost = costFromSales;
        console.log(`[altegio/inventory] ✅ Calculated cost from sales transactions (fields: ${possibleCostFields.join(', ')}): ${calculatedCost}`);
      }
    }
    
    // Варіант 2.1: Спробуємо знайти собівартість через зв'язок з транзакціями закупки
    // Для кожного проданого товару шукаємо останню ціну закупки
    if (calculatedCost === null && purchases.length > 0) {
      console.log(`[altegio/inventory] 🔍 Trying to match sales with purchases by good_id...`);
      
      // Створюємо мапу good_id -> остання ціна закупки
      const purchasePriceMap = new Map<number, number>();
      
      // Сортуємо закупки за датою (від новіших до старіших)
      const sortedPurchases = [...purchases].sort((a, b) => {
        const dateA = new Date(a.create_date || 0).getTime();
        const dateB = new Date(b.create_date || 0).getTime();
        return dateB - dateA; // Новіші спочатку
      });
      
      for (const purchase of sortedPurchases) {
        const goodId = purchase.good_id || purchase.good?.id;
        if (goodId && !purchasePriceMap.has(goodId)) {
          const costPerUnit = Number(purchase.cost_per_unit) || 0;
          const totalCost = Math.abs(Number(purchase.cost) || 0);
          const amount = Math.abs(Number(purchase.amount) || 0);
          
          // Визначаємо ціну за одиницю
          let pricePerUnit = 0;
          if (costPerUnit > 0) {
            pricePerUnit = costPerUnit;
          } else if (totalCost > 0 && amount > 0) {
            pricePerUnit = totalCost / amount;
          }
          
          if (pricePerUnit > 0) {
            purchasePriceMap.set(goodId, pricePerUnit);
            console.log(`[altegio/inventory] Mapped good_id ${goodId} to purchase price: ${pricePerUnit}`);
          }
        }
      }
      
      // Обчислюємо собівартість для проданих товарів
      if (purchasePriceMap.size > 0) {
        const costFromMatchedPurchases = sales.reduce((sum, sale) => {
          const goodId = sale.good_id || sale.good?.id;
          const amount = Math.abs(Number(sale.amount) || 0);
          
          if (goodId && purchasePriceMap.has(goodId) && amount > 0) {
            const purchasePrice = purchasePriceMap.get(goodId)!;
            return sum + (purchasePrice * amount);
          }
          return sum;
        }, 0);
        
        if (costFromMatchedPurchases > 0) {
          calculatedCost = costFromMatchedPurchases;
          console.log(`[altegio/inventory] ✅ Calculated cost by matching sales with purchases: ${calculatedCost} (matched ${purchasePriceMap.size} goods)`);
        }
      }
    }
    
    // Варіант 2.2: Якщо в налаштуваннях API cost_per_unit тепер містить оптову ціну (собівартість)
    // Тільки якщо не знайшли інші способи
    if (calculatedCost === null) {
      const costFromCostPerUnit = sales.reduce((sum, t) => {
        const costPerUnit = Number(t.cost_per_unit) || 0;
        const amount = Math.abs(Number(t.amount) || 0);
        if (costPerUnit > 0 && amount > 0) {
          return sum + (costPerUnit * amount);
        }
        return sum;
      }, 0);
      
      if (costFromCostPerUnit > 0) {
        calculatedCost = costFromCostPerUnit;
        console.log(`[altegio/inventory] ⚠️ Using cost_per_unit as cost (may be incorrect if it's sale price): ${calculatedCost}`);
      }
    }
  }

  // Варіант 3: Спробуємо отримати собівартість з Payments API
  // Можливо, там є транзакції закупки товарів
  if (calculatedCost === null) {
    try {
      console.log(`[altegio/inventory] 🔍 Trying Payments API for cost data...`);
      const paymentsPath = `/transactions/${companyId}?start_date=${date_from}&end_date=${date_to}&real_money=1&deleted=0&count=1000`;
      const paymentsRaw = await altegioFetch<any>(paymentsPath);
      
      const paymentsTx: any[] = Array.isArray(paymentsRaw)
        ? paymentsRaw
        : paymentsRaw && typeof paymentsRaw === "object" && Array.isArray((paymentsRaw as any).data)
          ? (paymentsRaw as any).data
          : [];
      
      // Шукаємо транзакції, пов'язані з закупкою товарів
      // Можливо, вони мають type="purchase" або expense з назвою "Product purchase"
      const purchasePayments = paymentsTx.filter((t: any) => {
        const expenseTitle = t.expense?.title || t.expense?.name || "";
        return expenseTitle.toLowerCase().includes("purchase") ||
               expenseTitle.toLowerCase().includes("product purchase") ||
               expenseTitle.toLowerCase().includes("закупка") ||
               t.type === "purchase";
      });
      
      if (purchasePayments.length > 0) {
        console.log(`[altegio/inventory] Found ${purchasePayments.length} purchase transactions in Payments API`);
        const costFromPayments = purchasePayments.reduce((sum: number, t: any) => {
          const amount = Math.abs(Number(t.amount) || 0);
          return sum + amount;
        }, 0);
        
        if (costFromPayments > 0) {
          calculatedCost = costFromPayments;
          console.log(`[altegio/inventory] ✅ Calculated cost from Payments API purchase transactions: ${calculatedCost}`);
        }
      }
    } catch (err: any) {
      console.warn(`[altegio/inventory] ⚠️ Failed to fetch cost from Payments API:`, err?.message || String(err));
    }
  }

  /** Якщо Σ default_cost_total з документів «зламалась» і перевищує capBase×1.05 (totals.goods або склад) — не використовуємо її */
  if (
    saleDocumentsCostSum !== null &&
    saleDocumentsCostSum > 0 &&
    capBaseForGoodsCost > 0
  ) {
    const revenueCap = Math.round(capBaseForGoodsCost * 1.05 * 100) / 100;
    if (saleDocumentsCostSum > revenueCap) {
      const rejected = saleDocumentsCostSum;
      saleDocumentsBlendedSumRejectedByCap = rejected;
      console.warn(
        `[altegio/inventory][cogs-cap] Собівартість з документів/мапи (${rejected}) > capBase×1.05 (${revenueCap}, capBase=${capBaseForGoodsCost}). Повний вибір COGS — рядок з тегом [COGS_SUMMARY] у цьому ж запиті (у Vercel розгорни GET /admin/finance-report → усі повідомлення функції).`,
      );
      saleDocumentsCostSum = null;
      if (calculatedCost !== null && Math.abs(calculatedCost - rejected) < 0.02) {
        calculatedCost = null;
      }
    }
  }

  /** Те саме cap для паралельної Σ first_cost — не пропонувати завищений first-basis */
  if (
    saleDocumentsFirstBasisSum !== null &&
    saleDocumentsFirstBasisSum > 0 &&
    capBaseForGoodsCost > 0
  ) {
    const revenueCap = Math.round(capBaseForGoodsCost * 1.05 * 100) / 100;
    if (saleDocumentsFirstBasisSum > revenueCap) {
      console.warn(
        `[altegio/inventory] ⚠️ Σ first_cost по документах (${saleDocumentsFirstBasisSum}) більша за capBase×1.05 (${revenueCap}, capBase=${capBaseForGoodsCost}); ігноруємо кандидат sale_document_first`,
      );
      saleDocumentsFirstBasisSum = null;
    }
  }

  /** Відсікати кандидатів, у яких сума ≈ виручка «Товари» (помилково підставлений цінник замість COGS) */
  const tolRevenueCopy = 0.5;
  const looksLikeGoodsRevenueNotCost = (c: number) =>
    typeof salonGoodsRevenueUah === "number" &&
    salonGoodsRevenueUah > 0 &&
    c > 0 &&
    Math.abs(c - salonGoodsRevenueUah) <= tolRevenueCopy;

  type CostPickSource = NonNullable<GoodsSalesSummary["costSource"]>;
  /**
   * Часто Σ default_cost_total з /sale/{id} завищена vs «Аналіз продажів» (комплекти, зайві рядки),
   * а goods_transactions.actual_cost ближче до фактичного списання складу.
   */
  const docSum = saleDocumentsCostSum;
  /** Для sale_document_first: blended могли відкинути cap-ом, але порівняння з R лишається валідним */
  const docSumForFirstHeuristic = docSum ?? saleDocumentsBlendedSumRejectedByCap;
  const actSum = actualCostFromGoodsTransactions;
  const actualCoverage = sales.length > 0 ? actualCostSuccessfulTxn / sales.length : 0;
  const preferActualCostOverSaleDocument =
    docSum !== null &&
    docSum > 0 &&
    actSum !== null &&
    actSum > 0 &&
    actSum < docSum &&
    docSum - actSum >= 5_000 &&
    docSum / actSum <= 1.28 &&
    actualCoverage >= 0.12;

  /** Узгодження з рядком «Товари» з analytics: якщо Σ з документів дає надто високу частку COGS у виручки, а actual — у типовому коридорі — actual має бути ПЕРШИМ кандидатом (раніше actual йшов після doc і ніколи не вигравав). */
  const R = salonGoodsRevenueUah;
  const relGapDocAct =
    docSum != null && actSum != null && docSum > 0 && actSum > 0 && actSum < docSum
      ? (docSum - actSum) / docSum
      : 0;
  const leadActualCostFirstByGoodsRevenue =
    typeof R === "number" &&
    R > 0 &&
    actSum !== null &&
    actSum > 0 &&
    docSum !== null &&
    docSum > 0 &&
    actSum < docSum &&
    relGapDocAct >= 0.08 &&
    docSum / R > 0.615 &&
    actSum / R <= 0.62 &&
    actSum / R >= 0.48;

  const leadActualCostFirst = leadActualCostFirstByGoodsRevenue || preferActualCostOverSaleDocument;

  const firstSum = saleDocumentsFirstBasisSum;
  /** У кабінеті «Аналіз продажів» часто нижча сума, ніж Σ default/manual у рядках — тоді actual_cost з API збігається з blended doc і не проходить leadActual. */
  const preferFirstCostDocumentBasis =
    typeof R === "number" &&
    R > 0 &&
    firstSum !== null &&
    firstSum > 0 &&
    docSumForFirstHeuristic !== null &&
    docSumForFirstHeuristic > 0 &&
    firstSum < docSumForFirstHeuristic - 1 &&
    docSumForFirstHeuristic / R > 0.615 &&
    firstSum / R <= 0.62 &&
    firstSum / R >= 0.42;

  if (preferFirstCostDocumentBasis) {
    console.log(
      `[altegio/inventory] ℹ️ Σ з документів (blended) ${docSumForFirstHeuristic} дає занадто високу частку COGS vs виручка «Товари» (${R}); обираємо Σ first/prime/purchase по тих самих документах: ${firstSum}`,
    );
  }

  const analyticsGoodsCostPick =
    typeof R === "number" && R > 0
      ? pickGoodsCostFromIncomeGoodsStatsExtras(incomeGoodsStatsExtras, R)
      : null;

  if (leadActualCostFirstByGoodsRevenue) {
    console.log(
      `[altegio/inventory] ℹ️ COGS з документів (${docSum}) завелика vs виручка «Товари» (${R}); Σ goods_transactions.actual_cost (${actSum}) у коридорі — пріоритет actual_cost`,
    );
  } else if (preferActualCostOverSaleDocument) {
    console.log(
      `[altegio/inventory] ℹ️ Σ з документів (${docSum}) вища за Σ actual_cost (${actSum}); пріоритет actual_cost (покриття транзакцій ${(actualCoverage * 100).toFixed(0)}%)`,
    );
  }

  const costCandidates: Array<{ value: number; source: CostPickSource }> = [];
  /** First-basis з тих самих документів — найближче до колонки собівартості в «Аналізі продажів»; перед actual, бо actual часто = blended doc. */
  if (preferFirstCostDocumentBasis && firstSum !== null && firstSum > 0) {
    costCandidates.push({ value: firstSum, source: "sale_document_first" });
  }
  if (analyticsGoodsCostPick !== null && analyticsGoodsCostPick > 0) {
    costCandidates.push({ value: analyticsGoodsCostPick, source: "analytics_goods" });
  }
  /** Σ(amount зі складу type_id=1) × собівартість за одиницю (V2 cost_price або V1 unit_actual / довідник) — перед actual, бо actual часто збігається з «завеликим» документом */
  if (goodsCardCost !== null && goodsCardCost > 0) {
    costCandidates.push({ value: goodsCardCost, source: "goods_card" });
  }
  if (leadActualCostFirst && actSum !== null && actSum > 0) {
    costCandidates.push({ value: actSum, source: "actual_cost" });
  }
  if (docSum !== null && docSum > 0) {
    costCandidates.push({ value: docSum, source: "sale_document" });
  }
  /** Якщо actual не лідер, але зібраний з ≥35% транзакцій */
  const actualInsertedEarly =
    !leadActualCostFirst &&
    actSum !== null &&
    actSum > 0 &&
    actualCoverage >= 0.35;
  if (actualInsertedEarly) {
    costCandidates.push({ value: actSum!, source: "actual_cost" });
  }
  if (calculatedCost !== null && calculatedCost > 0) {
    costCandidates.push({ value: calculatedCost, source: "fallback" });
  }
  if (!leadActualCostFirst && !actualInsertedEarly && actSum !== null && actSum > 0) {
    costCandidates.push({ value: actSum, source: "actual_cost" });
  }
  if (manualCost !== null && manualCost > 0) {
    costCandidates.push({ value: manualCost, source: "manual" });
  }

  let finalCost = 0;
  let costSource: GoodsSalesSummary["costSource"] = "none";

  for (const { value, source } of costCandidates) {
    if (looksLikeGoodsRevenueNotCost(value)) {
      console.warn(
        `[altegio/inventory] ⚠️ Пропускаємо джерело "${source}" (${value} грн): збігається з виручкою «Товари» з аналітики (${salonGoodsRevenueUah}) — не використовуємо як собівартість`,
      );
      continue;
    }
    finalCost = value;
    costSource = source;
    break;
  }

  /** Один рядок warning — його видно у Vercel за замовчуванням (info/log часто сховані у фільтрі «Warnings») */
  console.warn(
    `[altegio/inventory][COGS_SUMMARY] ${JSON.stringify({
      source: costSource,
      finalCost,
      revenueGoodsRow: typeof salonGoodsRevenueUah === "number" ? salonGoodsRevenueUah : null,
      docBlended: docSum,
      docBlendedRejectedByCap: saleDocumentsBlendedSumRejectedByCap,
      firstNarrowSum: saleDocumentsFirstBasisSum,
      actualCostSum: actSum,
      analyticsExtrasPick: analyticsGoodsCostPick,
      preferFirstRule: preferFirstCostDocumentBasis,
      capBase: capBaseForGoodsCost,
    })}`,
  );

  if (costSource === "sale_document_first") {
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість із документів продажу (лише first_cost / first_cost_total по рядках, узгоджено з типовим «Аналізом продажів»): ${finalCost}`,
    );
  } else if (costSource === "sale_document") {
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість із документів продажу (default_cost_total), як у звіті Altegio «Аналіз продажів»: ${finalCost}`,
    );
    if (goodsCardCost !== null && goodsCardCost > 0 && Math.abs(goodsCardCost - finalCost) > 1) {
      console.log(
        `[altegio/inventory] ℹ️ Для довідки: собівартість з карток товарів була б ${goodsCardCost} грн (часто вища/нижча через actual_cost довідника vs факт у документі).`,
      );
    }
  } else if (costSource === "goods_card") {
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість із карток товарів: ${finalCost}`,
    );
  } else if (costSource === "fallback") {
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість з резервних джерел (закупівлі/поля транзакцій тощо): ${finalCost}`,
    );
  } else if (costSource === "actual_cost") {
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість проданого товару з goods_transactions.actual_cost: ${finalCost}`,
    );
  } else if (costSource === "analytics_goods") {
    console.log(
      `[altegio/inventory] ✅ Використовуємо собівартість з поля analytics/overall → income_goods_stats: ${finalCost}`,
    );
  } else if (costSource === "manual") {
    console.log(`[altegio/inventory] ✅ Використовуємо ручну собівартість з KV: ${finalCost}`);
  } else {
    console.log(
      `[altegio/inventory] ⚠️ Собівартість не визначена (усі кандидати відсіяні або відсутні). Перевірте документи продажу та поля actual_cost/default_cost_total у Altegio.`,
    );
  }

  // Розраховуємо націнку як revenue - cost
  const profit = revenue - finalCost;
  console.log(
    `[altegio/inventory] Profit = revenue - cost: ${profit} (revenue: ${revenue}, cost: ${finalCost})`,
  );

  // Конвертуємо мапу товарів у масив та сортуємо за назвою
  const goodsListSource =
    (costSource === "sale_document" || costSource === "sale_document_first") && goodsMap.size > 0
      ? Array.from(goodsMap.values())
      : goodsCardGoodsList && goodsCardGoodsList.length > 0
        ? goodsCardGoodsList
        : Array.from(goodsMap.values());
  const goodsList = goodsListSource
    .sort((a, b) => a.title.localeCompare(b.title, 'uk-UA'));
  
  console.log(`[altegio/inventory] 📦 Підсумковий список товарів: ${goodsList.length} позицій`);

  const purchasesType2TotalUah = sumStorageTransactionsCostUah(purchasesType2);
  const receiptsType3TotalUah = sumStorageTransactionsCostUah(receiptsType3);
  const writeOffsTotalUah = sumStorageTransactionsCostUah(writeOffs);
  const purchasesTotalUah =
    Math.round((purchasesType2TotalUah + receiptsType3TotalUah) * 100) / 100;

  const costOfGoodsSoldUah = Math.round(finalCost * 100) / 100;
  const impliedNetChangeUah =
    Math.round((purchasesTotalUah - costOfGoodsSoldUah - writeOffsTotalUah) * 100) / 100;

  const cogsGoodsCardUah =
    goodsCardCost != null && goodsCardCost > 0
      ? Math.round(goodsCardCost * 100) / 100
      : null;
  const impliedNetChangeGoodsCardUah =
    cogsGoodsCardUah != null
      ? Math.round((purchasesTotalUah - cogsGoodsCardUah - writeOffsTotalUah) * 100) / 100
      : null;

  console.log(
    `[altegio/inventory] 📊 Оцінка руху складу: продажі type1=${sales.length} ряд. / COGS=${costOfGoodsSoldUah} грн; надходження type2+3=${purchasesTotalUah} грн (type2 закупівля ${purchasesType2TotalUah}, type3 прийомка ${receiptsType3TotalUah}); інші списання≈${writeOffsTotalUah} грн; Δ звіт=${impliedNetChangeUah}; Δ картки=${impliedNetChangeGoodsCardUah ?? "—"}`,
  );

  return {
    range: { date_from, date_to },
    revenue,
    cost: finalCost,
    profit,
    costSource,
    itemsCount: sales.length,
    totalItemsSold,
    costItemsCount: costItemsCount > 0 ? costItemsCount : undefined,
    costTransactionsCount:
      costSource === "actual_cost" && actualCostSuccessfulTxn > 0
        ? actualCostSuccessfulTxn
        : (costSource === "sale_document" || costSource === "sale_document_first") &&
            saleDocumentLoadsWithCost > 0
          ? saleDocumentLoadsWithCost
          : costTransactionsCount > 0
            ? costTransactionsCount
            : undefined,
    goodsList: goodsList.length > 0 ? goodsList : undefined,
    warehouseMovementEstimate: {
      purchasesTotalUah,
      purchasesType2TotalUah,
      purchasesType2Count: purchasesType2.length,
      receiptsType3TotalUah,
      receiptsType3Count: receiptsType3.length,
      writeOffsTotalUah,
      writeOffTransactionsCount: writeOffs.length,
      costOfGoodsSoldUah,
      impliedNetChangeUah,
      cogsGoodsCardUah,
      impliedNetChangeGoodsCardUah,
      salesTransactionsCount: sales.length,
      purchaseTransactionsCount: purchases.length,
    },
  };
}

