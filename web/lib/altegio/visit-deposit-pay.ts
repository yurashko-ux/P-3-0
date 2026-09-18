// Оплата візиту з особистого рахунку клієнта (завдаток) в Altegio.
// PUT visits (послуги) → document_id → POST /company/{id}/sale/{document_id}/payment

import { ALTEGIO_ENV } from "./env";
import { altegioFetch, AltegioHttpError } from "./client";
import { getVisitDetails } from "./visits";
import type { VisitCheckoutServiceLine, VisitCheckoutWriteResult } from "./visit-checkout-write";

function resolveCompanyId(): string {
  const companyId =
    process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID || "";
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не задано — неможливо оплатити з завдатку");
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

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatAltegioError(err: unknown, action: string): Error {
  if (err instanceof AltegioHttpError) {
    const body = String(err.responseBody || "").slice(0, 500);
    return new Error(`Altegio ${action}: HTTP ${err.status} ${body || err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function extractDocumentId(raw: unknown): number | null {
  const data = unwrapData(raw);
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const direct = Number(
    d.document_id ?? d.documentId ?? (d.document as any)?.id ?? (d.sale as any)?.id ?? d.id,
  );
  if (Number.isFinite(direct) && direct > 0) {
    // visit_id інколи потрапляє в id — перевіримо нижче через інші шляхи
    return Math.trunc(direct);
  }
  for (const key of ["finance_transactions", "transactions", "payment_transactions", "items"]) {
    const arr = d[key];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      const id = Number(
        (row as any)?.document_id ?? (row as any)?.documentId ?? (row as any)?.document?.id,
      );
      if (Number.isFinite(id) && id > 0) return Math.trunc(id);
    }
  }
  return null;
}

/** Дотягнути document_id sale/visit після PUT visits. */
export async function resolveVisitSaleDocumentId(params: {
  visitId: number;
  recordId: number;
  putRaw?: unknown;
}): Promise<number | null> {
  const fromPut = extractDocumentId(params.putRaw);
  if (fromPut && fromPut !== params.visitId && fromPut !== params.recordId) {
    console.log(`[altegio/visit-deposit] document_id з PUT: ${fromPut}`);
    return fromPut;
  }
  if (fromPut) {
    // Може бути і visit_id — все одно спробуємо, якщо інших немає
  }

  const companyId = resolveCompanyId();
  const companyNum = Number(companyId);

  try {
    const details = await getVisitDetails(companyNum, params.recordId, params.visitId);
    const fromDetails = extractDocumentId(details);
    if (fromDetails) {
      console.log(`[altegio/visit-deposit] document_id з visit/details: ${fromDetails}`);
      return fromDetails;
    }
    const items = Array.isArray(details?.items) ? details.items : [];
    for (const item of items) {
      const id = Number(item?.document_id ?? item?.documentId);
      if (Number.isFinite(id) && id > 0) return Math.trunc(id);
    }
  } catch (err) {
    console.warn(
      `[altegio/visit-deposit] visit/details не дав document_id:`,
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const rawTx = await altegioFetch<unknown>(
      `/timetable/transactions/${companyId}?record_id=${params.recordId}`,
    );
    const unwrapped = unwrapData(rawTx);
    const list = Array.isArray(unwrapped)
      ? (unwrapped as any[])
      : Array.isArray((unwrapped as any)?.transactions)
        ? (unwrapped as any).transactions
        : Array.isArray((unwrapped as any)?.data)
          ? (unwrapped as any).data
          : [];
    for (const t of list) {
      const id = Number(t?.document_id ?? t?.documentId);
      if (Number.isFinite(id) && id > 0) {
        console.log(`[altegio/visit-deposit] document_id з timetable: ${id}`);
        return Math.trunc(id);
      }
    }
  } catch (err) {
    console.warn(
      `[altegio/visit-deposit] timetable не дав document_id:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Останній fallback: у частини інсталяцій document_id візиту = visit_id
  if (fromPut) return fromPut;
  console.log(`[altegio/visit-deposit] fallback document_id=visit_id=${params.visitId}`);
  return params.visitId > 0 ? params.visitId : null;
}

export async function payVisitSaleFromDeposit(params: {
  documentId: number;
  depositId: number;
  amount: number;
}): Promise<{ transactionIds: number[]; raw: unknown }> {
  const companyId = resolveCompanyId();
  const amount = toMoney(params.amount);
  if (!(params.documentId > 0)) throw new Error("Немає document_id для оплати з завдатку");
  if (!(params.depositId > 0)) throw new Error("Немає deposit_id");
  if (!(amount > 0)) throw new Error("Сума оплати з завдатку має бути > 0");

  const endpoint = `/company/${companyId}/sale/${params.documentId}/payment`;
  const payload = {
    method: { slug: "deposit", deposit_id: params.depositId },
    amount,
  };
  console.log(
    `[altegio/visit-deposit] POST ${endpoint} deposit_id=${params.depositId} amount=${amount}`,
  );

  try {
    const raw = await altegioFetch<unknown>(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = unwrapData(raw);
    const txs = Array.isArray(data?.payment_transactions)
      ? data.payment_transactions
      : Array.isArray(data?.state?.payment_transactions)
        ? data.state.payment_transactions
        : [];
    const transactionIds = (txs as any[])
      .map((t) => Number(t?.id ?? t?.transaction_id) || 0)
      .filter((n) => n > 0);
    console.log(
      `[altegio/visit-deposit] ✅ Оплачено з завдатку doc=${params.documentId} txs=${transactionIds.join(",") || "—"}`,
    );
    return { transactionIds, raw };
  } catch (err) {
    throw formatAltegioError(err, `оплата з завдатку doc=${params.documentId}`);
  }
}

/**
 * Закрити візит послугами + оплатити з особистого рахунку (завдаток).
 * Спочатку PUT visits без касового new_transactions, потім sale/payment slug=deposit.
 */
export async function closeVisitPaidFromDeposit(params: {
  visitId: number;
  recordId: number;
  attendance?: number;
  comment?: string;
  services: VisitCheckoutServiceLine[];
  depositId: number;
  amount: number;
}): Promise<VisitCheckoutWriteResult & { documentId: number }> {
  // Крок 1: зафіксувати послуги / attendance без касової оплати.
  const services = params.services.map((s) => {
    const amount = Number(s.amount) > 0 ? Number(s.amount) : 1;
    const firstCost = toMoney(Number(s.firstCost) || Number(s.cost) || 0);
    const cost = toMoney(Number(s.cost) || firstCost);
    return {
      id: s.id,
      title: s.title || undefined,
      amount,
      first_cost: firstCost,
      discount: Number(s.discount) || 0,
      cost,
      cost_per_unit: amount > 0 ? toMoney(cost / amount) : cost,
      record_id: params.recordId,
    };
  });

  const putPath = `/visits/${params.visitId}/${params.recordId}`;
  const putPayload = {
    attendance: params.attendance ?? 1,
    comment: params.comment || "",
    services,
    new_transactions: [] as Array<{ amount: number; account_id: number }>,
  };
  console.log(
    `[altegio/visit-deposit] PUT ${putPath} services=${services.length} (без каси, далі deposit)`,
  );

  let putRaw: unknown;
  try {
    putRaw = await altegioFetch<unknown>(putPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(putPayload),
    });
  } catch (err) {
    // Якщо порожній new_transactions не приймається — пробуємо без поля взагалі
    try {
      const { new_transactions: _, ...withoutTx } = putPayload;
      putRaw = await altegioFetch<unknown>(putPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withoutTx),
      });
    } catch (err2) {
      throw formatAltegioError(err2, `підготовка візиту ${params.visitId}/${params.recordId}`);
    }
  }

  const documentId = await resolveVisitSaleDocumentId({
    visitId: params.visitId,
    recordId: params.recordId,
    putRaw,
  });
  if (!(documentId && documentId > 0)) {
    throw new Error("Не вдалося визначити document_id візиту для оплати з завдатку");
  }

  const paid = await payVisitSaleFromDeposit({
    documentId,
    depositId: params.depositId,
    amount: params.amount,
  });

  return {
    visitId: params.visitId,
    recordId: params.recordId,
    transactionIds: paid.transactionIds,
    documentId,
    raw: paid.raw,
  };
}
