// Закриття візиту в Altegio: послуги + оплата на рахунок.
// PUT /visits/{visit_id}/{record_id} з new_transactions.

import { ALTEGIO_ENV } from "./env";
import { altegioFetch, AltegioHttpError } from "./client";
import { getVisitWithRecords } from "./visits";

function resolveCompanyId(): string {
  const companyId =
    process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID || "";
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не задано — неможливо закрити візит у Altegio");
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

function formatAltegioError(err: unknown, action: string): Error {
  if (err instanceof AltegioHttpError) {
    const body = String(err.responseBody || "").slice(0, 500);
    return new Error(`Altegio ${action}: HTTP ${err.status} ${body || err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export type VisitCheckoutServiceLine = {
  id: number;
  amount?: number;
  firstCost?: number;
  cost?: number;
  discount?: number;
  title?: string;
  recordId?: number;
};

export type VisitCheckoutPaymentLine = {
  accountId: number;
  amount: number;
};

/** Рядок goods_transactions візиту. Нові без id; наявні передаємо як є. */
export type VisitGoodsTransaction = Record<string, unknown>;

/** Новий продаж товару у форматі goods_transactions (amount < 0 — продаж). */
export function buildVisitGoodsSale(params: {
  goodId: number;
  storageId: number;
  quantity: number;
  unitPrice: number;
  masterId: number | null;
}): VisitGoodsTransaction {
  const unitPrice = toMoney(params.unitPrice);
  return {
    good_id: params.goodId,
    storage_id: params.storageId,
    amount: -Math.abs(params.quantity),
    cost_per_unit: unitPrice,
    price: unitPrice,
    cost: toMoney(unitPrice * Math.abs(params.quantity)),
    discount: 0,
    operation_unit_type: 1,
    ...(params.masterId ? { master_id: params.masterId } : {}),
  };
}

export type VisitCheckoutWriteInput = {
  visitId: number;
  recordId: number;
  attendance?: number;
  comment?: string;
  services: VisitCheckoutServiceLine[];
  payments: VisitCheckoutPaymentLine[];
  goodsTransactions?: VisitGoodsTransaction[];
};

export type VisitCheckoutWriteResult = {
  visitId: number;
  recordId: number;
  transactionIds: number[];
  raw: unknown;
};

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Дотягнути visit_id з GET record, якщо в Kresco його ще немає. */
export async function resolveAltegioVisitId(recordId: number): Promise<number | null> {
  if (!(recordId > 0)) return null;
  const companyId = resolveCompanyId();
  const paths = [
    `/record/${companyId}/${recordId}`,
    `/records/${companyId}/${recordId}`,
    `/records/${recordId}`,
  ];
  for (const path of paths) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const data = unwrapData(raw);
      const visitId = Number(data?.visit_id ?? data?.visitId) || 0;
      if (visitId > 0) {
        console.log(`[altegio/visit-checkout] visit_id=${visitId} для record=${recordId} (${path})`);
        return visitId;
      }
    } catch (err) {
      console.warn(
        `[altegio/visit-checkout] Не вдалося прочитати visit_id ${path}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return null;
}

/**
 * Послуги інших записів цього візиту. PUT /visits замінює послуги всього візиту,
 * тому без них закриття одного запису стирає послуги решти майстрів.
 */
export async function fetchOtherVisitLines(
  visitId: number,
  recordId: number,
): Promise<{ services: VisitCheckoutServiceLine[]; goods: VisitGoodsTransaction[] }> {
  const visit = await getVisitWithRecords(visitId, Number(resolveCompanyId()));
  if (!visit) {
    throw new Error(`Не вдалося прочитати візит ${visitId} в Altegio — закриття зупинено, щоб не стерти послуги`);
  }
  const lines: VisitCheckoutServiceLine[] = [];
  // Товари належать візиту й повторюються в кожному записі.
  const goodsById = new Map<number, VisitGoodsTransaction>();
  for (const record of visit.records) {
    for (const g of record.goods_transactions || []) {
      if (Number(g?.id) > 0) goodsById.set(Number(g.id), g);
    }
    if (Number(record.id) === recordId) continue;
    for (const s of record.services || []) {
      lines.push({
        id: Number(s?.id) || 0,
        amount: Number(s?.amount) || 1,
        firstCost: Number(s?.first_cost) || Number(s?.cost) || 0,
        cost: Number(s?.cost) || 0,
        discount: Number(s?.discount) || 0,
        title: s?.title ? String(s.title) : undefined,
        recordId: Number(record.id),
      });
    }
  }
  return { services: lines.filter((l) => l.id > 0), goods: [...goodsById.values()] };
}

export async function closeVisitInAltegio(input: VisitCheckoutWriteInput): Promise<VisitCheckoutWriteResult> {
  const visitId = Number(input.visitId) || 0;
  const recordId = Number(input.recordId) || 0;
  if (!(visitId > 0) || !(recordId > 0)) {
    throw new Error("Для закриття візиту потрібні visit_id і record_id Altegio");
  }
  if (!input.services.length) {
    throw new Error("Немає послуг для закриття візиту");
  }
  if (!input.payments.length) {
    throw new Error("Вкажіть рахунок і суму оплати");
  }

  const services = input.services.map((s) => {
    const amount = Number(s.amount) > 0 ? Number(s.amount) : 1;
    const firstCost = toMoney(Number(s.firstCost) || Number(s.cost) || 0);
    const discount = Number(s.discount) || 0;
    const cost = toMoney(Number(s.cost) || firstCost);
    return {
      id: s.id,
      title: s.title || undefined,
      amount,
      first_cost: firstCost,
      discount,
      cost,
      cost_per_unit: amount > 0 ? toMoney(cost / amount) : cost,
      record_id: s.recordId || recordId,
    };
  });

  const newTransactions = input.payments.map((p) => ({
    amount: toMoney(p.amount),
    account_id: p.accountId,
  }));

  const payload = {
    attendance: input.attendance ?? 1,
    comment: input.comment || "",
    services,
    new_transactions: newTransactions,
    ...(input.goodsTransactions?.length ? { goods_transactions: input.goodsTransactions } : {}),
  };

  const path = `/visits/${visitId}/${recordId}`;
  console.log(
    `[altegio/visit-checkout] PUT ${path} services=${services.length} pay=${newTransactions.map((t) => `${t.account_id}:${t.amount}`).join(",")}`,
  );

  try {
    const raw = await altegioFetch<unknown>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = unwrapData(raw);
    const txs = Array.isArray(data?.finance_transactions)
      ? data.finance_transactions
      : Array.isArray(data?.transactions)
        ? data.transactions
        : Array.isArray((data as any)?.payment_transactions)
          ? (data as any).payment_transactions
          : [];
    const transactionIds = (txs as any[])
      .map((t) => Number(t?.id ?? t?.transaction_id) || 0)
      .filter((n) => n > 0);
    console.log(
      `[altegio/visit-checkout] ✅ Закрито visit=${visitId} record=${recordId} txs=${transactionIds.join(",") || "—"}`,
    );
    return { visitId, recordId, transactionIds, raw };
  } catch (err) {
    throw formatAltegioError(err, `закриття візиту ${visitId}/${recordId}`);
  }
}
