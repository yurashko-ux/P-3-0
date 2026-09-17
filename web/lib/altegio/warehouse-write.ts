// Запис складу в Altegio: картка товару, прийомка (type 3), списання (type 4), переміщення (type 5).
// Фінансову статтю «Закупівля товарів» не створюємо вручну — вона з’являється зі складського документа.

import { ALTEGIO_ENV } from "./env";
import { altegioFetch, AltegioHttpError } from "./client";

export const ALTEGIO_STORAGE_OP = {
  sale: 1,
  receipt: 3,
  writeOff: 4,
  transfer: 5,
} as const;

export type AltegioGoodCreateInput = {
  title: string;
  categoryId: number;
  unit?: string;
  costUah: number;
  comment?: string;
  article?: string;
};

export type AltegioStorageOperationLine = {
  goodId: number;
  amount: number;
  costUah: number;
};

function resolveCompanyId(): string {
  const companyId =
    process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID || "";
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не задано — неможливо писати склад у Altegio");
  }
  return companyId;
}

function unwrapData(raw: unknown): any {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.data != null && typeof obj.data === "object") {
    const inner = obj.data as Record<string, unknown>;
    if (inner.data != null) return inner.data;
    return obj.data;
  }
  return raw;
}

function extractNumericId(raw: unknown): number | null {
  const data = unwrapData(raw);
  const candidates = [
    (data as any)?.id,
    (data as any)?.document?.id,
    (data as any)?.good_id,
    (data as any)?.transaction_id,
    (data as any)?.document_id,
    (data as any)?.operation_id,
    Array.isArray(data) ? (data[0] as any)?.id : null,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function formatKyivDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function toTxLine(params: {
  goodId: number;
  amount: number;
  costUah: number;
  storageId?: number;
  operationUnitType: number;
  comment?: string;
}) {
  const amount = params.amount;
  const abs = Math.abs(amount);
  const cost = Math.round((Number(params.costUah) || 0) * 100) / 100;
  const costPerUnit = abs > 0 ? Math.round((cost / abs) * 100) / 100 : cost;
  return {
    good_id: params.goodId,
    amount,
    cost,
    cost_per_unit: costPerUnit,
    discount: 0,
    operation_unit_type: params.operationUnitType,
    supplier_id: 0,
    client_id: 0,
    master_id: 0,
    comment: params.comment || "",
    ...(params.storageId && params.storageId > 0 ? { storage_id: params.storageId } : {}),
  };
}

async function postStorageOperationBodies(companyId: string, bodies: unknown[]): Promise<{ id: number }> {
  let lastErr: unknown = null;
  for (const body of bodies) {
    try {
      console.log(
        `[altegio/warehouse-write] POST /storage_operations/operation payload:`,
        JSON.stringify(body).slice(0, 800),
      );
      const raw = await altegioFetch<unknown>(`/storage_operations/operation/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const id = extractNumericId(raw);
      if (!id) {
        throw new Error(`Altegio не повернув id операції: ${JSON.stringify(raw).slice(0, 300)}`);
      }
      console.log(`[altegio/warehouse-write] Операція створена id=${id}`);
      return { id };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[altegio/warehouse-write] Спроба POST /storage_operations/operation не пройшла:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  throw formatAltegioError(lastErr, "складська операція");
}

function formatAltegioError(err: unknown, action: string): Error {
  if (err instanceof AltegioHttpError) {
    const body = String(err.responseBody || "").slice(0, 500);
    return new Error(`Altegio ${action}: HTTP ${err.status} ${body || err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function listAltegioGoodsCategories(): Promise<Array<{ id: number; title: string }>> {
  const companyId = resolveCompanyId();
  const paths = [`/goods_categories/${companyId}`, `/goods_category/${companyId}`];
  for (const path of paths) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const data = unwrapData(raw);
      const list = Array.isArray(data) ? data : Array.isArray((data as any)?.categories) ? (data as any).categories : [];
      const rows: Array<{ id: number; title: string }> = [];
      for (const item of list) {
        const id = Number(item?.id ?? item?.category_id ?? 0);
        const title = String(item?.title ?? item?.name ?? "").trim();
        if (id > 0 && title) rows.push({ id, title });
      }
      if (rows.length > 0) {
        console.log(`[altegio/warehouse-write] Категорії товарів: ${rows.length} (${path})`);
        return rows;
      }
    } catch (err) {
      console.warn(`[altegio/warehouse-write] Не вдалося прочитати категорії ${path}:`, err instanceof Error ? err.message : err);
    }
  }
  return [];
}

export async function createAltegioStorage(title: string): Promise<{ id: number; title: string }> {
  const companyId = resolveCompanyId();
  const trimmed = title.trim();
  const payloads = [{ title: trimmed }, { title: trimmed, for_sale: 1 }];
  const paths = [`/storages/${companyId}`, `/company/${companyId}/storages`];
  let lastErr: unknown = null;
  for (const path of paths) {
    for (const payload of payloads) {
      try {
        const raw = await altegioFetch<unknown>(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const id = extractNumericId(raw);
        if (!id) {
          throw new Error(`Altegio не повернув id складу: ${JSON.stringify(raw).slice(0, 300)}`);
        }
        console.log(`[altegio/warehouse-write] Створено склад «${trimmed}» id=${id} (${path})`);
        return { id, title: trimmed };
      } catch (err) {
        lastErr = err;
        console.warn(
          `[altegio/warehouse-write] Спроба створити склад ${path} не пройшла:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  throw formatAltegioError(lastErr, `створення складу «${trimmed}»`);
}

export async function createAltegioGoodsCategory(title: string): Promise<{ id: number; title: string }> {
  const companyId = resolveCompanyId();
  const payload = { title: title.trim(), parent_id: 0 };
  try {
    const raw = await altegioFetch<unknown>(`/goods_categories/${companyId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const id = extractNumericId(raw);
    if (!id) {
      throw new Error(`Altegio не повернув id категорії: ${JSON.stringify(raw).slice(0, 300)}`);
    }
    console.log(`[altegio/warehouse-write] Створено категорію «${title}» id=${id}`);
    return { id, title: title.trim() };
  } catch (err) {
    throw formatAltegioError(err, `створення категорії «${title}»`);
  }
}

export async function getAltegioGood(goodId: number): Promise<any> {
  const companyId = resolveCompanyId();
  const raw = await altegioFetch<unknown>(`/goods/${companyId}/${goodId}`);
  return unwrapData(raw);
}

const DEFAULT_CORRECTION_RULES = [
  { type: 1, base_unit: "service" },
  { type: 2, base_unit: "service" },
  { type: 3, base_unit: "sale" },
  { type: 4, base_unit: "sale" },
  { type: 5, base_unit: "sale" },
];

export async function updateAltegioGoodCategory(goodId: number, categoryId: number): Promise<void> {
  const companyId = resolveCompanyId();
  if (!(goodId > 0) || !(categoryId > 0)) {
    throw new Error("Для зміни категорії потрібні id товару і категорії Altegio");
  }
  const good = await getAltegioGood(goodId);
  const title = String(good?.title || good?.name || "").trim();
  if (!title) throw new Error(`Товар Altegio ${goodId} без назви`);

  const saleUnitId = Number(good?.sale_unit_id ?? good?.unit_id ?? 0);
  const serviceUnitId = Number(good?.service_unit_id ?? good?.unit_id ?? saleUnitId);
  const payload: Record<string, unknown> = {
    title,
    category_id: categoryId,
    article: String(good?.article || ""),
    barcode: String(good?.barcode || ""),
    comment: String(good?.comment || ""),
    cost: Number(good?.cost) || 0,
    actual_cost: Number(good?.actual_cost) || 0,
    unit_equals: Number(good?.unit_equals) || 1,
  };
  if (saleUnitId > 0) payload.sale_unit_id = saleUnitId;
  if (serviceUnitId > 0) payload.service_unit_id = serviceUnitId;

  const put = async (body: Record<string, unknown>) => {
    await altegioFetch<unknown>(`/goods/${companyId}/${goodId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  try {
    await put(payload);
  } catch (err) {
    if (err instanceof AltegioHttpError && err.status === 409) {
      await put({ ...payload, correction_rules: DEFAULT_CORRECTION_RULES });
    } else if (err instanceof AltegioHttpError && err.status === 422) {
      await put({
        title,
        category_id: categoryId,
        ...(saleUnitId > 0 ? { sale_unit_id: saleUnitId } : {}),
        ...(serviceUnitId > 0 ? { service_unit_id: serviceUnitId } : {}),
      });
    } else {
      throw formatAltegioError(err, `зміна категорії товару ${goodId}`);
    }
  }
  console.log(`[altegio/warehouse-write] Товар ${goodId} «${title}» → category_id=${categoryId}`);
}

export async function createAltegioGood(input: AltegioGoodCreateInput): Promise<{ id: number }> {
  const companyId = resolveCompanyId();
  if (!(input.categoryId > 0)) {
    throw new Error("Для картки товару в Altegio потрібна категорія");
  }
  const cost = Math.round((Number(input.costUah) || 0) * 100) / 100;
  const payload = {
    title: input.title.trim(),
    category_id: input.categoryId,
    unit: input.unit || "шт",
    cost,
    actual_cost: cost,
    comment: input.comment || "",
    article: input.article || "",
  };
  try {
    const raw = await altegioFetch<unknown>(`/goods/${companyId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const id = extractNumericId(raw);
    if (!id) {
      throw new Error(`Altegio не повернув id товару: ${JSON.stringify(raw).slice(0, 400)}`);
    }
    console.log(`[altegio/warehouse-write] Створено товар «${payload.title}» id=${id}, собівартість=${cost} грн`);
    return { id };
  } catch (err) {
    throw formatAltegioError(err, `створення товару «${input.title}»`);
  }
}

export async function createAltegioStorageOperation(params: {
  typeId: number;
  storageId: number;
  date: Date;
  comment: string;
  lines: AltegioStorageOperationLine[];
}): Promise<{ id: number }> {
  const companyId = resolveCompanyId();
  if (!(params.storageId > 0)) {
    throw new Error("У складі Kresco немає id складу Altegio — синхронізуйте дзеркало");
  }
  const operationUnitType = params.typeId === ALTEGIO_STORAGE_OP.writeOff ? 2 : 1;
  const tx = params.lines
    .filter((line) => line.goodId > 0 && line.amount !== 0)
    .map((line) =>
      toTxLine({
        goodId: line.goodId,
        amount: Math.abs(line.amount),
        costUah: line.costUah,
        operationUnitType,
        comment: params.comment,
      }),
    );
  if (tx.length === 0) {
    throw new Error("Немає рядків для складської операції Altegio");
  }

  const createDate = formatKyivDateTime(params.date);
  const base = {
    type_id: params.typeId,
    storage_id: params.storageId,
    create_date: createDate,
    date: createDate,
    comment: params.comment,
    master_id: 0,
  };
  const legacyGoods = tx.map((line) => ({
    good_id: line.good_id,
    amount: line.amount,
    cost: line.cost,
    cost_per_unit: line.cost_per_unit,
  }));

  console.log(
    `[altegio/warehouse-write] Операція type=${params.typeId} storage=${params.storageId} рядків=${tx.length}`,
  );
  return postStorageOperationBodies(companyId, [
    { ...base, goods_transactions: tx },
    { ...base, transactions: tx },
    { type_id: params.typeId, storage_id: params.storageId, date: createDate, comment: params.comment, goods: legacyGoods },
    { operation: { ...base, goods_transactions: tx } },
  ]);
}

export async function createAltegioStorageTransfer(params: {
  fromStorageId: number;
  toStorageId: number;
  date: Date;
  comment: string;
  lines: AltegioStorageOperationLine[];
}): Promise<{ id: number }> {
  const companyId = resolveCompanyId();
  if (!(params.fromStorageId > 0) || !(params.toStorageId > 0)) {
    throw new Error("Для переміщення потрібні id складів Altegio на обох сторонах");
  }
  const createDate = formatKyivDateTime(params.date);
  const toLines = params.lines
    .filter((line) => line.goodId > 0 && line.amount !== 0)
    .map((line) =>
      toTxLine({
        goodId: line.goodId,
        amount: Math.abs(line.amount),
        costUah: line.costUah,
        storageId: params.toStorageId,
        operationUnitType: 2,
        comment: params.comment,
      }),
    );
  if (toLines.length === 0) {
    throw new Error("Немає рядків для переміщення в Altegio");
  }
  const pairLines = params.lines
    .filter((line) => line.goodId > 0 && line.amount !== 0)
    .flatMap((line) => {
      const abs = Math.abs(line.amount);
      return [
        toTxLine({
          goodId: line.goodId,
          amount: -abs,
          costUah: line.costUah,
          storageId: params.fromStorageId,
          operationUnitType: 2,
          comment: params.comment,
        }),
        toTxLine({
          goodId: line.goodId,
          amount: abs,
          costUah: line.costUah,
          storageId: params.toStorageId,
          operationUnitType: 2,
          comment: params.comment,
        }),
      ];
    });

  const base = {
    type_id: ALTEGIO_STORAGE_OP.transfer,
    storage_id: params.fromStorageId,
    create_date: createDate,
    date: createDate,
    comment: params.comment,
    master_id: 0,
  };

  console.log(
    `[altegio/warehouse-write] Переміщення ${params.fromStorageId} → ${params.toStorageId} рядків=${toLines.length}`,
  );
  try {
    return await postStorageOperationBodies(companyId, [
      { ...base, goods_transactions: toLines },
      { ...base, transactions: toLines },
      { ...base, goods_transactions: pairLines },
      {
        ...base,
        target_storage_id: params.toStorageId,
        storage_id_to: params.toStorageId,
        goods_transactions: toLines.map(({ storage_id: _s, ...rest }) => rest),
      },
      { ...base, goods: toLines },
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${message}. Перевірте, що товар є на складі-джерелі в Altegio (залишки) і що склади різні.`,
    );
  }
}
