// Запис складу в Altegio: картка товару, категорія, прийомка (type 3), списання (type 4).
// Фінансову статтю «Закупівля товарів» не створюємо вручну — вона з’являється зі складського документа.

import { ALTEGIO_ENV } from "./env";
import { altegioFetch, AltegioHttpError } from "./client";

export const ALTEGIO_STORAGE_OP = {
  sale: 1,
  receipt: 3,
  writeOff: 4,
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
  const goods = params.lines
    .filter((line) => line.goodId > 0 && line.amount !== 0)
    .map((line) => {
      const amount = Math.abs(line.amount);
      const cost = Math.round((Number(line.costUah) || 0) * 100) / 100;
      return {
        good_id: line.goodId,
        amount,
        cost,
        cost_per_unit: amount > 0 ? Math.round((cost / amount) * 100) / 100 : cost,
      };
    });
  if (goods.length === 0) {
    throw new Error("Немає рядків для складської операції Altegio");
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const d = params.date;
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const payload = {
    type_id: params.typeId,
    storage_id: params.storageId,
    date: dateStr,
    comment: params.comment,
    goods,
  };

  const bodies = [payload, { operation: payload }];
  let lastErr: unknown = null;
  for (const body of bodies) {
    try {
      const raw = await altegioFetch<unknown>(`/storage_operations/operation/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const id = extractNumericId(raw) || Date.now();
      console.log(
        `[altegio/warehouse-write] Операція type=${params.typeId} storage=${params.storageId} id=${id} рядків=${goods.length}`,
      );
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
