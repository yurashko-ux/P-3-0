// Джерело «Kresco» для зведення вхідних (етап A відмови від транзакцій Altegio).
// Будує доходи з таблиць Kresco і порівнює їх з доходами Altegio, які зараз ідуть у зведення.
// Зведення не змінює: лише діагностика розбіжностей. Altegio не вимикаємо.
//
// Джерела Kresco:
//  - SalonCheckoutPayment (оплата візиту на рахунок, без оплат із завдатку);
//  - FinanceDocument type=income (ручний прихід);
//  - ClientDepositLedgerEntry kind=topup (поповнення завдатку; рахунок надходження не зберігається).
// Готівкові рахунки (Каса, Долар, Євро) не порівнюємо — з monobank їх не зводимо.

import { prisma } from "@/lib/prisma";
import {
  loadAltegioIncomeRows,
  resolveIncomingRange,
  type NormalizedAltegioIncomeRow,
} from "@/lib/bank/incoming-altegio-aggregate";
import { isCashReconcileAccount } from "@/lib/bank/incoming-reconcile-matching";

/** altegio — лише Altegio (порівняння вимкнено); compare — Altegio у зведенні + порівняння з Kresco. */
export type BankIncomeSourceMode = "altegio" | "compare";

export function getBankIncomeSourceMode(): BankIncomeSourceMode {
  const raw = String(process.env.BANK_INCOME_SOURCE ?? "compare").trim().toLowerCase();
  return raw === "altegio" ? "altegio" : "compare";
}

export type KrescoIncomeKind = "checkout_payment" | "finance_document" | "deposit_topup";

export type KrescoIncomeRow = {
  /** Унікальний ключ рядка Kresco (kind:id). */
  key: string;
  kind: KrescoIncomeKind;
  kyivDay: string;
  /** Altegio account id рядком; null — рахунок невідомий (поповнення завдатку). */
  accountId: string | null;
  accountTitle: string;
  payerName: string;
  amountKop: bigint;
  /** Транзакція Altegio, якою цей рядок продубльований (для звірки 1:1). */
  altegioTransactionIds: number[];
  /** kresco | altegio — звідки рядок потрапив у Kresco. */
  origin: string;
  note: string | null;
};

const UNKNOWN_ACCOUNT_TITLE = "— рахунок невідомий —";

function toKop(uah: number): bigint {
  return BigInt(Math.round(Number(uah || 0) * 100));
}

function isDepositAccountTitle(title: string): boolean {
  return /депозит|deposit|рахунк[иі] клієнт|рахунок клієнт|personal account|loyalty/i.test(title || "");
}

/** Чи бере рахунок участь у порівнянні (безготівковий, не рахунок клієнта). */
function isComparableAccountTitle(title: string): boolean {
  const t = (title || "").trim();
  if (!t || t === UNKNOWN_ACCOUNT_TITLE) return true;
  if (isCashReconcileAccount(t)) return false;
  if (isDepositAccountTitle(t)) return false;
  return true;
}

function personName(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p || "").trim()).filter(Boolean).join(" ");
}

export async function loadKrescoIncomeRows(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<KrescoIncomeRow[]> {
  const { dateFrom, dateTo } = params;
  const dayRange = { gte: dateFrom, lte: dateTo };

  const [payments, documents, topups] = await Promise.all([
    prisma.salonCheckoutPayment.findMany({
      where: {
        paymentKind: { not: "deposit" },
        amount: { gt: 0 },
        checkout: { kyivDay: dayRange, status: { not: "void" } },
      },
      select: {
        id: true,
        accountId: true,
        accountTitle: true,
        amount: true,
        altegioTransactionId: true,
        checkout: {
          select: {
            kyivDay: true,
            source: true,
            appointment: {
              select: {
                clientName: true,
                directClient: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.financeDocument.findMany({
      where: { type: "income", kyivDay: dayRange, status: { not: "void" }, amountUah: { gt: 0 } },
      select: {
        id: true,
        kyivDay: true,
        accountId: true,
        accountTitle: true,
        amountUah: true,
        purposeTitle: true,
        comment: true,
        source: true,
        altegioTransactionId: true,
      },
    }),
    prisma.clientDepositLedgerEntry.findMany({
      where: { kind: "topup", kyivDay: dayRange, amount: { gt: 0 } },
      select: {
        id: true,
        kyivDay: true,
        amount: true,
        source: true,
        comment: true,
        altegioPaymentTxId: true,
        altegioDepositTxId: true,
        account: {
          select: { directClient: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
  ]);

  const rows: KrescoIncomeRow[] = [];

  for (const p of payments) {
    const client = p.checkout.appointment;
    rows.push({
      key: `checkout_payment:${p.id}`,
      kind: "checkout_payment",
      kyivDay: p.checkout.kyivDay,
      accountId: String(p.accountId),
      accountTitle: p.accountTitle?.trim() || `Рахунок ${p.accountId}`,
      payerName:
        personName([client?.directClient?.lastName, client?.directClient?.firstName])
        || client?.clientName?.trim()
        || "— без клієнта —",
      amountKop: toKop(p.amount),
      altegioTransactionIds: p.altegioTransactionId ? [p.altegioTransactionId] : [],
      origin: p.checkout.source,
      note: null,
    });
  }

  for (const d of documents) {
    rows.push({
      key: `finance_document:${d.id}`,
      kind: "finance_document",
      kyivDay: d.kyivDay,
      accountId: String(d.accountId),
      accountTitle: d.accountTitle?.trim() || `Рахунок ${d.accountId}`,
      payerName: d.purposeTitle?.trim() || "Прихід",
      amountKop: toKop(d.amountUah),
      altegioTransactionIds: d.altegioTransactionId ? [d.altegioTransactionId] : [],
      origin: d.source,
      note: d.comment,
    });
  }

  for (const t of topups) {
    const ids = [t.altegioPaymentTxId, t.altegioDepositTxId].filter(
      (id): id is number => id != null && id > 0,
    );
    rows.push({
      key: `deposit_topup:${t.id}`,
      kind: "deposit_topup",
      kyivDay: t.kyivDay,
      accountId: null,
      accountTitle: UNKNOWN_ACCOUNT_TITLE,
      payerName:
        personName([t.account.directClient?.lastName, t.account.directClient?.firstName])
        || "— без клієнта —",
      amountKop: toKop(t.amount),
      altegioTransactionIds: ids,
      origin: t.source,
      note: t.comment,
    });
  }

  return rows.filter((row) => isComparableAccountTitle(row.accountTitle));
}

// ---------- Порівняння ----------

export type IncomeCompareRowRef = {
  side: "altegio" | "kresco";
  key: string;
  kind: string;
  kyivDay: string;
  accountTitle: string;
  payerName: string;
  amountKop: string;
  altegioTransactionId: number | null;
  note: string | null;
};

export type IncomeCompareMismatch = {
  altegioTransactionId: number;
  altegio: IncomeCompareRowRef;
  kresco: IncomeCompareRowRef;
  /** amount | day | account */
  reasons: string[];
};

export type IncomeCompareDayAccount = {
  accountTitle: string;
  altegioKop: string;
  krescoKop: string;
  diffKop: string;
};

export type IncomeCompareDay = {
  kyivDay: string;
  altegioKop: string;
  krescoKop: string;
  diffKop: string;
  accounts: IncomeCompareDayAccount[];
};

export type IncomeSourceCompareResult = {
  mode: BankIncomeSourceMode;
  dateFrom: string;
  dateTo: string;
  totals: {
    altegioKop: string;
    krescoKop: string;
    diffKop: string;
    altegioRows: number;
    krescoRows: number;
    matchedRows: number;
    onlyAltegio: number;
    onlyKresco: number;
    mismatched: number;
    /** Дні, де суми не сходяться (різниця ≥ 1 грн). */
    daysWithDiff: number;
  };
  byKind: Record<KrescoIncomeKind, { rows: number; kop: string }>;
  days: IncomeCompareDay[];
  onlyAltegio: IncomeCompareRowRef[];
  onlyKresco: IncomeCompareRowRef[];
  mismatched: IncomeCompareMismatch[];
};

function altegioRef(row: NormalizedAltegioIncomeRow): IncomeCompareRowRef {
  return {
    side: "altegio",
    key: `altegio:${row.altegioId}`,
    kind: row.documentId != null ? "altegio_document" : "altegio_manual_income",
    kyivDay: row.kyivDay,
    accountTitle: row.accountTitle,
    payerName: row.payerName,
    amountKop: row.amountKop.toString(),
    altegioTransactionId: row.altegioId,
    note: row.paymentPurpose,
  };
}

function krescoRef(row: KrescoIncomeRow, accountTitle?: string): IncomeCompareRowRef {
  return {
    side: "kresco",
    key: row.key,
    kind: row.kind,
    kyivDay: row.kyivDay,
    accountTitle: accountTitle || row.accountTitle,
    payerName: row.payerName,
    amountKop: row.amountKop.toString(),
    altegioTransactionId: row.altegioTransactionIds[0] ?? null,
    note: row.note,
  };
}

function absKop(v: bigint): bigint {
  return v < 0n ? -v : v;
}

const HRYVNIA_KOP = 100n;

export async function compareIncomeSources(params: {
  dateFrom?: string;
  dateTo?: string;
  fetchLive?: boolean;
} = {}): Promise<IncomeSourceCompareResult> {
  const mode = getBankIncomeSourceMode();
  const { dateFrom, dateTo } = resolveIncomingRange(params);

  const [altegioIncome, krescoRowsAll] = await Promise.all([
    loadAltegioIncomeRows({ dateFrom, dateTo, fetchLive: params.fetchLive }),
    loadKrescoIncomeRows({ dateFrom, dateTo }),
  ]);
  const altegioRows = altegioIncome.rows.filter((row) => isComparableAccountTitle(row.accountTitle));

  const altegioById = new Map<number, NormalizedAltegioIncomeRow>();
  for (const row of altegioRows) altegioById.set(row.altegioId, row);

  const matchedAltegioIds = new Set<number>();
  const onlyKresco: IncomeCompareRowRef[] = [];
  const mismatched: IncomeCompareMismatch[] = [];
  let matchedRows = 0;

  // Рахунок для поповнень завдатку беремо з транзакції Altegio, якщо вона є.
  const resolvedAccount = new Map<string, { id: string | null; title: string }>();

  for (const row of krescoRowsAll) {
    const altegio = row.altegioTransactionIds
      .map((id) => altegioById.get(id))
      .find((r): r is NormalizedAltegioIncomeRow => Boolean(r));
    if (row.accountId == null && altegio) {
      resolvedAccount.set(row.key, { id: altegio.accountId, title: altegio.accountTitle });
    }
    if (!altegio || matchedAltegioIds.has(altegio.altegioId)) {
      onlyKresco.push(krescoRef(row));
      continue;
    }
    matchedAltegioIds.add(altegio.altegioId);
    matchedRows += 1;

    const reasons: string[] = [];
    if (absKop(altegio.amountKop - row.amountKop) >= HRYVNIA_KOP) reasons.push("amount");
    if (altegio.kyivDay !== row.kyivDay) reasons.push("day");
    if (row.accountId != null && altegio.accountId != null && altegio.accountId !== row.accountId) {
      reasons.push("account");
    }
    if (reasons.length > 0) {
      mismatched.push({
        altegioTransactionId: altegio.altegioId,
        altegio: altegioRef(altegio),
        kresco: krescoRef(row),
        reasons,
      });
    }
  }

  const onlyAltegio = altegioRows
    .filter((row) => !matchedAltegioIds.has(row.altegioId))
    .map(altegioRef);

  // Суми по днях і рахунках (ключ рахунку — назва, бо в Altegio-рядках id інколи немає).
  type Bucket = { altegioKop: bigint; krescoKop: bigint; accounts: Map<string, { altegioKop: bigint; krescoKop: bigint }> };
  const days = new Map<string, Bucket>();
  const bucket = (day: string, account: string) => {
    let d = days.get(day);
    if (!d) {
      d = { altegioKop: 0n, krescoKop: 0n, accounts: new Map() };
      days.set(day, d);
    }
    let a = d.accounts.get(account);
    if (!a) {
      a = { altegioKop: 0n, krescoKop: 0n };
      d.accounts.set(account, a);
    }
    return { d, a };
  };
  for (const row of altegioRows) {
    const { d, a } = bucket(row.kyivDay, row.accountTitle);
    d.altegioKop += row.amountKop;
    a.altegioKop += row.amountKop;
  }
  const byKind: IncomeSourceCompareResult["byKind"] = {
    checkout_payment: { rows: 0, kop: "0" },
    finance_document: { rows: 0, kop: "0" },
    deposit_topup: { rows: 0, kop: "0" },
  };
  for (const row of krescoRowsAll) {
    const title = resolvedAccount.get(row.key)?.title || row.accountTitle;
    const { d, a } = bucket(row.kyivDay, title);
    d.krescoKop += row.amountKop;
    a.krescoKop += row.amountKop;
    byKind[row.kind].rows += 1;
    byKind[row.kind].kop = (BigInt(byKind[row.kind].kop) + row.amountKop).toString();
  }

  const dayRows: IncomeCompareDay[] = Array.from(days.entries())
    .sort(([l], [r]) => (l < r ? 1 : l > r ? -1 : 0))
    .map(([kyivDay, d]) => ({
      kyivDay,
      altegioKop: d.altegioKop.toString(),
      krescoKop: d.krescoKop.toString(),
      diffKop: (d.krescoKop - d.altegioKop).toString(),
      accounts: Array.from(d.accounts.entries())
        .map(([accountTitle, a]) => ({
          accountTitle,
          altegioKop: a.altegioKop.toString(),
          krescoKop: a.krescoKop.toString(),
          diffKop: (a.krescoKop - a.altegioKop).toString(),
        }))
        .sort((l, r) => l.accountTitle.localeCompare(r.accountTitle, "uk")),
    }));

  const altegioKop = altegioRows.reduce((s, r) => s + r.amountKop, 0n);
  const krescoKop = krescoRowsAll.reduce((s, r) => s + r.amountKop, 0n);
  const daysWithDiff = dayRows.filter((d) => absKop(BigInt(d.diffKop)) >= HRYVNIA_KOP).length;

  const result: IncomeSourceCompareResult = {
    mode,
    dateFrom,
    dateTo,
    totals: {
      altegioKop: altegioKop.toString(),
      krescoKop: krescoKop.toString(),
      diffKop: (krescoKop - altegioKop).toString(),
      altegioRows: altegioRows.length,
      krescoRows: krescoRowsAll.length,
      matchedRows,
      onlyAltegio: onlyAltegio.length,
      onlyKresco: onlyKresco.length,
      mismatched: mismatched.length,
      daysWithDiff,
    },
    byKind,
    days: dayRows,
    onlyAltegio,
    onlyKresco,
    mismatched,
  };

  console.log("[bank/incoming-kresco-income] Порівняння джерел доходів", {
    mode,
    dateFrom,
    dateTo,
    ...result.totals,
  });

  return result;
}
