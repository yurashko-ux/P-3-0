// Поповнення особистого рахунку клієнта (завдаток) в Altegio.
// POST /deposits_operations/{location_id}

import { ALTEGIO_ENV } from "./env";
import { altegioFetch, AltegioHttpError } from "./client";

function resolveCompanyId(): string {
  const companyId =
    process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID || "";
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не задано — неможливо поповнити завдаток");
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

export type DepositTopUpInput = {
  clientId: number;
  depositId: number;
  amount: number;
  /** Каса / ФОП / еквайринг — звідки прийшли гроші */
  accountId: number;
  masterId?: number | null;
  comment?: string;
};

export type DepositTopUpResult = {
  documentId: number | null;
  depositTransactionId: number | null;
  paymentTransactionId: number | null;
  balanceAfter: number | null;
  raw: unknown;
};

export async function topUpClientDepositInAltegio(input: DepositTopUpInput): Promise<DepositTopUpResult> {
  const companyId = resolveCompanyId();
  const clientId = Number(input.clientId) || 0;
  const depositId = Number(input.depositId) || 0;
  const accountId = Number(input.accountId) || 0;
  const amount = toMoney(Number(input.amount) || 0);

  if (!(clientId > 0)) throw new Error("Немає client_id Altegio");
  if (!(depositId > 0)) throw new Error("Немає deposit_id");
  if (!(accountId > 0)) throw new Error("Оберіть рахунок, з якого поповнюєте");
  if (!(amount > 0)) throw new Error("Сума поповнення має бути більше 0");

  const payload: Record<string, unknown> = {
    client_id: clientId,
    deposit_id: depositId,
    amount,
    account_id: accountId,
  };
  if (input.masterId && Number(input.masterId) > 0) {
    payload.master_id = Number(input.masterId);
  }
  if (input.comment) {
    payload.comment = String(input.comment).slice(0, 500);
  }

  const path = `/deposits_operations/${companyId}`;
  console.log(
    `[altegio/deposit-topup] POST ${path} client=${clientId} deposit=${depositId} amount=${amount} account=${accountId}`,
  );

  try {
    const raw = await altegioFetch<unknown>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = unwrapData(raw);
    const documentId = Number(data?.document?.id ?? data?.document_id) || null;
    const depTx = Array.isArray(data?.deposits_transactions) ? data.deposits_transactions[0] : null;
    const payTx = Array.isArray(data?.payment_transactions) ? data.payment_transactions[0] : null;
    const depositTransactionId = Number(depTx?.id) || null;
    const paymentTransactionId = Number(payTx?.id) || null;
    const balanceAfter =
      depTx?.balance_after != null && Number.isFinite(Number(depTx.balance_after))
        ? toMoney(Number(depTx.balance_after))
        : depTx?.deposit?.balance != null
          ? toMoney(Number(depTx.deposit.balance))
          : null;

    console.log(
      `[altegio/deposit-topup] ✅ Поповнено deposit=${depositId} doc=${documentId || "—"} balanceAfter=${balanceAfter ?? "—"}`,
    );
    return { documentId, depositTransactionId, paymentTransactionId, balanceAfter, raw };
  } catch (err) {
    throw formatAltegioError(err, `поповнення завдатку deposit=${depositId}`);
  }
}
