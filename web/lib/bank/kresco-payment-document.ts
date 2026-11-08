// Документ Креско для зведеного вихідного банківського платежу.
// Перехідний період: документ Altegio створюється як і раніше, а Креско тримає свою копію
// (Розхід або Переміщення) і прив'язує її до того самого зведення — BankAltegioPaymentMatch.financeDocumentId.
// Коли Altegio вимкнено (ALTEGIO_DISABLED=1), стаття адміна одразу дає документ Креско і зведення без Altegio.

import { prisma } from "@/lib/prisma";
import { isTransferPurposeTitle } from "@/lib/altegio/finance-transactions-create";
import { resolveBankPaymentExpenseArticle } from "@/lib/bank/altegio-payment-reconcile";
import { ensureReconciliationNumber } from "@/lib/bank/reconciliation-number";
import { BANK_DOCUMENT_SOURCE } from "@/lib/bank/bank-document-source";

/** Altegio вимкнено: зведення й документи лише в Креско. */
export function isAltegioDisabled(): boolean {
  return process.env.ALTEGIO_DISABLED === "1";
}

const LINKED_STATUSES = ["auto_matched", "manual_matched"];


function kyivDayOf(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const matchSelect = {
  id: true,
  status: true,
  financeDocumentId: true,
  altegioFinanceTransactionId: true,
  altegioFinanceTransaction: {
    select: {
      altegioId: true,
      accountId: true,
      categoryTitle: true,
      paymentPurpose: true,
      expenseId: true,
      direction: true,
      kyivDay: true,
      operationDate: true,
      amountKopiykas: true,
    },
  },
  pendingPayments: {
    take: 1,
    orderBy: { createdAt: "desc" as const },
    select: { purposeId: true, purposeTitle: true, status: true },
  },
  bankStatementItem: {
    select: {
      id: true,
      time: true,
      amount: true,
      comment: true,
      description: true,
      account: { select: { altegioAccountId: true, altegioAccountTitle: true } },
    },
  },
} as const;

type MatchRow = NonNullable<Awaited<ReturnType<typeof loadMatch>>>;

function loadMatch(bankStatementItemId: string) {
  return prisma.bankAltegioPaymentMatch.findUnique({ where: { bankStatementItemId }, select: matchSelect });
}

/**
 * Друга нога переміщення в Altegio (+ на рахунку призначення): той самий день і сума, інший рахунок.
 * Потрібна, щоб Каса не порахувала переміщення двічі (операція Altegio + документ Креско).
 */
async function findTransferCounterpart(match: MatchRow) {
  const source = match.altegioFinanceTransaction;
  if (!source) return null;
  const amount = source.amountKopiykas < BigInt(0) ? -source.amountKopiykas : source.amountKopiykas;
  const candidates = await prisma.altegioFinanceTransaction.findMany({
    where: {
      kyivDay: source.kyivDay,
      amountKopiykas: amount,
      deletedInAltegio: false,
      altegioId: { not: source.altegioId },
      ...(source.accountId ? { NOT: { accountId: source.accountId } } : {}),
    },
    select: { altegioId: true, accountId: true, accountTitle: true, operationDate: true },
    take: 10,
  });
  const sourceTime = source.operationDate.getTime();
  return (
    candidates.sort(
      (a, b) => Math.abs(a.operationDate.getTime() - sourceTime) - Math.abs(b.operationDate.getTime() - sourceTime),
    )[0] ?? null
  );
}

export type KrescoDocumentResult =
  | { created: true; documentId: string }
  | { created: false; reason: string; documentId?: string };

/**
 * Створює документ Креско для зведеного платежу, якщо його ще немає.
 * fromPending — режим без Altegio: зводить платіж за статтею, яку обрав адмін.
 */
export async function ensureKrescoDocumentForPayment(
  bankStatementItemId: string,
  options: { fromPending?: boolean; createdBy?: string | null } = {},
): Promise<KrescoDocumentResult> {
  const match = await loadMatch(bankStatementItemId);
  if (!match) return { created: false, reason: "no_match" };
  if (match.financeDocumentId) return { created: false, reason: "exists", documentId: match.financeDocumentId };
  if (match.status === "ignored") return { created: false, reason: "ignored" };

  const statement = match.bankStatementItem;
  if (!(statement.amount < BigInt(0))) return { created: false, reason: "not_outgoing" };
  const accountId = Number(statement.account.altegioAccountId) || 0;
  if (!(accountId > 0)) return { created: false, reason: "no_account" };

  const pending = match.pendingPayments[0];
  const linkedToAltegio = Boolean(match.altegioFinanceTransactionId);
  if (!linkedToAltegio && !(options.fromPending && pending?.purposeTitle)) {
    return { created: false, reason: "not_reconciled" };
  }

  const purposeTitle =
    resolveBankPaymentExpenseArticle(match) || pending?.purposeTitle?.trim() || "Інші витрати";
  const transfer =
    isTransferPurposeTitle(purposeTitle) || match.altegioFinanceTransaction?.direction === "transfer";

  let counterAccountId: number | null = null;
  let counterAccountTitle: string | null = null;
  let counterAltegioId: number | null = null;
  if (transfer) {
    // Без другої ноги не знаємо рахунок призначення — спробуємо в наступному запуску
    const counterpart = linkedToAltegio ? await findTransferCounterpart(match) : null;
    if (!counterpart?.accountId) return { created: false, reason: "transfer_counterpart_missing" };
    counterAccountId = Number(counterpart.accountId) || null;
    counterAccountTitle = counterpart.accountTitle;
    counterAltegioId = counterpart.altegioId;
  }

  const amountUah = Number(-statement.amount) / 100;
  const bankText = statement.comment?.trim() || statement.description || "";
  const document = await prisma.financeDocument.create({
    data: {
      type: transfer ? "transfer" : "expense",
      status: "posted",
      syncStatus: linkedToAltegio ? "synced" : "local",
      source: BANK_DOCUMENT_SOURCE,
      title: transfer ? "Переміщення" : purposeTitle,
      amountUah,
      currency: "UAH",
      kyivDay: kyivDayOf(statement.time),
      occurredAt: statement.time,
      accountId,
      accountTitle: statement.account.altegioAccountTitle,
      counterAccountId,
      counterAccountTitle,
      purposeId: transfer ? null : pending?.purposeId ?? null,
      purposeTitle: transfer ? "Переміщення" : purposeTitle,
      purposeExternalId: match.altegioFinanceTransaction?.expenseId ?? null,
      comment: bankText ? `Банк: ${bankText}`.slice(0, 1000) : null,
      createdBy: options.createdBy || "bank-reconcile",
      // Номери операцій Altegio: Каса за ними не рахує той самий рух двічі
      altegioTransactionId: match.altegioFinanceTransaction?.altegioId ?? null,
      altegioCounterTransactionId: counterAltegioId,
    },
  });

  // Прив'язка лише якщо поле ще порожнє: паралельний запуск не створить другого зв'язку
  const linked = await prisma.bankAltegioPaymentMatch.updateMany({
    where: { id: match.id, financeDocumentId: null },
    data: {
      financeDocumentId: document.id,
      ...(linkedToAltegio
        ? {}
        : { status: "manual_matched", matchType: "kresco", matchedAt: new Date(), matchedBy: options.createdBy || "kresco" }),
    },
  });
  if (linked.count === 0) {
    await prisma.financeDocument.delete({ where: { id: document.id } });
    return { created: false, reason: "race" };
  }
  if (!linkedToAltegio) await ensureReconciliationNumber(bankStatementItemId);
  console.log(
    `[bank/kresco-document] ${transfer ? "Переміщення" : purposeTitle} ${amountUah} грн → документ ${document.id} (платіж ${bankStatementItemId})`,
  );
  return { created: true, documentId: document.id };
}

/** З якого часу створюємо документи Креско для зведених платежів (09.10.2026 00:00 Київ). */
const KRESCO_DOCUMENTS_FROM = new Date("2026-10-08T21:00:00.000Z");

/**
 * Документи Креско для вже зведених платежів, яких ще немає. Для cron.
 * Запити: 1 findMany + по 2–4 на кожен новий документ; limit тримає бюджет БД.
 */
export async function ensureKrescoDocumentsForReconciledPayments(limit = 100) {
  const rows = await prisma.bankAltegioPaymentMatch.findMany({
    where: {
      financeDocumentId: null,
      altegioFinanceTransactionId: { not: null },
      status: { in: LINKED_STATUSES },
      // Лише вихідні з 09.10.2026 (історія Каси) і не приховані чужі платежі: обсяг невеликий
      bankStatementItem: { amount: { lt: BigInt(0) }, paymentsHiddenAt: null, time: { gte: KRESCO_DOCUMENTS_FROM } },
    },
    select: { bankStatementItemId: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let created = 0;
  const skipped: Record<string, number> = {};
  for (const row of rows) {
    try {
      const result = await ensureKrescoDocumentForPayment(row.bankStatementItemId);
      if ("reason" in result) skipped[result.reason] = (skipped[result.reason] || 0) + 1;
      else created += 1;
    } catch (error) {
      skipped.error = (skipped.error || 0) + 1;
      console.warn("[bank/kresco-document] Не вдалося створити документ:", {
        bankStatementItemId: row.bankStatementItemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (rows.length > 0) console.log("[bank/kresco-document] Документи для зведених платежів", { checked: rows.length, created, skipped });
  return { checked: rows.length, created, skipped };
}
