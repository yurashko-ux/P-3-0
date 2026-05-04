// Контроль підписаних фінансових звітів: snapshot транзакцій Altegio та порівняння після підпису.

import { kvRead, kvWrite } from "@/lib/kv";
import type { AltegioFinanceTransaction } from "@/lib/altegio";

export type FinanceReportTransactionSnapshot = {
  id: number;
  fingerprint: string;
  amount: number;
  date: string;
  comment: string;
  expenseTitle: string;
  accountTitle: string;
  documentId: number | null;
  deleted: boolean;
  lastChangeDate: string;
};

export type FinanceReportSignature = {
  version: 1;
  year: number;
  month: number;
  signedAt: string;
  encashment: number;
  encashmentFactAltegio: number;
  transactions: FinanceReportTransactionSnapshot[];
};

export type FinanceReportAuditChange = {
  type: "created" | "changed" | "deleted";
  transaction: FinanceReportTransactionSnapshot;
  previous?: FinanceReportTransactionSnapshot;
  documentUrl: string | null;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function getExpenseTitle(transaction: AltegioFinanceTransaction): string {
  return normalizeText(
    transaction.expense?.title ||
      transaction.expense?.name ||
      transaction.expense?.category ||
      (transaction as any).expense_title ||
      (transaction as any).expense_name,
  );
}

function getAccountTitle(transaction: AltegioFinanceTransaction): string {
  return normalizeText(
    transaction.account?.title ||
      transaction.account?.name ||
      (transaction as any).account_title ||
      (transaction as any).account_name,
  );
}

function getLastChangeDate(transaction: AltegioFinanceTransaction): string {
  return normalizeText(
    (transaction as any).last_change_date ||
      (transaction as any).updated_at ||
      (transaction as any).update_date ||
      (transaction as any).modified_at ||
      "",
  );
}

export function getFinanceReportSignatureKey(year: number, month: number): string {
  return `finance:report-signature:${year}:${month}`;
}

export function normalizeFinanceReportTransaction(
  transaction: AltegioFinanceTransaction,
): FinanceReportTransactionSnapshot | null {
  const id = toId(transaction.id);
  if (!id) return null;

  const snapshotBase = {
    id,
    amount: toNumber(transaction.amount),
    date: normalizeText(transaction.date),
    comment: normalizeText(transaction.comment),
    expenseTitle: getExpenseTitle(transaction),
    accountTitle: getAccountTitle(transaction),
    documentId: toId(transaction.document_id),
    deleted: Boolean(transaction.deleted),
    lastChangeDate: getLastChangeDate(transaction),
  };

  const fingerprintPayload = {
    amount: snapshotBase.amount,
    date: snapshotBase.date,
    comment: snapshotBase.comment,
    expenseTitle: snapshotBase.expenseTitle,
    accountTitle: snapshotBase.accountTitle,
    documentId: snapshotBase.documentId,
    deleted: snapshotBase.deleted,
    lastChangeDate: snapshotBase.lastChangeDate,
  };

  return {
    ...snapshotBase,
    fingerprint: JSON.stringify(fingerprintPayload),
  };
}

export function buildFinanceReportSnapshot(
  transactions: AltegioFinanceTransaction[] | null | undefined,
): FinanceReportTransactionSnapshot[] {
  return (Array.isArray(transactions) ? transactions : [])
    .map(normalizeFinanceReportTransaction)
    .filter((value): value is FinanceReportTransactionSnapshot => Boolean(value))
    .sort((a, b) => a.id - b.id);
}

export async function readFinanceReportSignature(
  year: number,
  month: number,
): Promise<FinanceReportSignature | null> {
  const raw = await kvRead.getRaw(getFinanceReportSignatureKey(year, month));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as FinanceReportSignature;
    if (
      parsed?.version === 1 &&
      parsed.year === year &&
      parsed.month === month &&
      Array.isArray(parsed.transactions)
    ) {
      return parsed;
    }
  } catch (err) {
    console.warn("[finance-report-signature] Не вдалося прочитати підпис звіту:", err);
  }

  return null;
}

export async function writeFinanceReportSignature(signature: FinanceReportSignature): Promise<void> {
  await kvWrite.setRaw(
    getFinanceReportSignatureKey(signature.year, signature.month),
    JSON.stringify(signature),
  );
}

export function buildAltegioFinanceDocumentUrl(documentId: number | null): string | null {
  if (!documentId) return null;

  const companyId =
    process.env.ALTEGIO_COMPANY_ID?.trim() ||
    process.env.ALTEGIO_PARTNER_ID?.trim() ||
    process.env.ALTEGIO_APPLICATION_ID?.trim() ||
    "";

  const params = new URLSearchParams({ document_id: String(documentId) });
  if (companyId) params.set("location_id", companyId);

  return `https://app.alteg.io/finance/transactions?${params.toString()}`;
}

export function compareFinanceReportSnapshot(
  signature: FinanceReportSignature | null,
  currentTransactions: AltegioFinanceTransaction[] | null | undefined,
): FinanceReportAuditChange[] {
  if (!signature) return [];

  const previousById = new Map(signature.transactions.map((transaction) => [transaction.id, transaction]));
  const currentSnapshots = buildFinanceReportSnapshot(currentTransactions);
  const currentById = new Map(currentSnapshots.map((transaction) => [transaction.id, transaction]));
  const changes: FinanceReportAuditChange[] = [];

  for (const current of currentSnapshots) {
    const previous = previousById.get(current.id);
    if (!previous) {
      changes.push({
        type: "created",
        transaction: current,
        documentUrl: buildAltegioFinanceDocumentUrl(current.documentId),
      });
      continue;
    }

    if (current.deleted && !previous.deleted) {
      changes.push({
        type: "deleted",
        transaction: current,
        previous,
        documentUrl: buildAltegioFinanceDocumentUrl(current.documentId || previous.documentId),
      });
      continue;
    }

    if (current.fingerprint !== previous.fingerprint) {
      changes.push({
        type: "changed",
        transaction: current,
        previous,
        documentUrl: buildAltegioFinanceDocumentUrl(current.documentId || previous.documentId),
      });
    }
  }

  for (const previous of signature.transactions) {
    if (!currentById.has(previous.id)) {
      changes.push({
        type: "deleted",
        transaction: previous,
        previous,
        documentUrl: buildAltegioFinanceDocumentUrl(previous.documentId),
      });
    }
  }

  return changes.sort((a, b) => {
    const dateA = a.transaction.lastChangeDate || a.transaction.date;
    const dateB = b.transaction.lastChangeDate || b.transaction.date;
    return String(dateB).localeCompare(String(dateA));
  });
}
