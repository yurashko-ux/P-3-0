// Готівкові рухи каси і проводка збіжною касовкою.
// У баланс після початкового залишку входять лише оплати Kresco і документи Kresco.
// Старі рядки Altegio до цього дня в проводку не беремо: вони вже в початковому залишку.

import { prisma } from "@/lib/prisma";
import { isCashAltegioAccount } from "@/lib/bank/incoming-reconcile-matching";
import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { isEurCashAccountTitle, isUsdCashAccountTitle } from "@/lib/journal/checkout";
import { CASH_OPENING_KYIV_DAY, CASH_RECONCILE_FROM_KYIV_DAY } from "@/lib/finance/cash-openings";

type CashCurrency = "UAH" | "USD" | "EUR";

export type CashBookMovement = {
  sourceType: "checkout_payment" | "finance_document";
  sourceId: string;
  accountId: number;
  accountTitle: string;
  currency: CashCurrency;
  direction: "in" | "out";
  amount: number;
  kyivDay: string;
  occurredAt: Date;
  title: string;
  recordId: number | null;
  altegioTransactionId: number | null;
};

export type CashLedgerCount = {
  id: string;
  kyivDay: string;
  counted: number;
  currency: string;
  createdAt: string;
  authorName: string;
};

export type CashLedgerRow = {
  id: string;
  sourceType: string;
  sourceId: string;
  accountId: number;
  accountTitle: string;
  currency: CashCurrency;
  direction: "in" | "out";
  amount: number;
  kyivDay: string;
  occurredAt: string;
  title: string;
  recordId: number | null;
  posted: boolean;
  count: CashLedgerCount | null;
};

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function postingKey(sourceType: string, sourceId: string, accountId: number): string {
  return `${sourceType}:${sourceId}:${accountId}`;
}

function currencyOfTitle(title: string): CashCurrency {
  if (isUsdCashAccountTitle(title)) return "USD";
  if (isEurCashAccountTitle(title)) return "EUR";
  return "UAH";
}

export function cashAmountsEqual(a: number, b: number): boolean {
  return Math.abs(money(a) - money(b)) < 0.009;
}

export async function loadCashBookMovements(
  accounts: Array<{ id: number; title: string; currency: CashCurrency }>,
): Promise<CashBookMovement[]> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const ids = accounts.map((account) => account.id);
  if (ids.length === 0) return [];
  const uahIds = accounts.filter((account) => account.currency === "UAH").map((account) => account.id);

  const [payments, documents] = await Promise.all([
    prisma.salonCheckoutPayment.findMany({
      where: {
        accountId: { in: ids },
        checkout: { kyivDay: { gt: CASH_OPENING_KYIV_DAY } },
      },
      select: {
        id: true,
        accountId: true,
        accountTitle: true,
        amount: true,
        amountFx: true,
        currencyCode: true,
        altegioTransactionId: true,
        checkout: {
          select: {
            kyivDay: true,
            createdAt: true,
            altegioRecordId: true,
            appointment: { select: { clientName: true, altegioRecordId: true } },
          },
        },
      },
    }),
    uahIds.length === 0
      ? Promise.resolve([])
      : prisma.financeDocument.findMany({
          where: {
            source: "kresco",
            status: { not: "void" },
            kyivDay: { gt: CASH_OPENING_KYIV_DAY },
            OR: [{ accountId: { in: uahIds } }, { counterAccountId: { in: uahIds } }],
          },
          select: {
            id: true,
            type: true,
            amountUah: true,
            accountId: true,
            counterAccountId: true,
            accountTitle: true,
            counterAccountTitle: true,
            kyivDay: true,
            occurredAt: true,
            title: true,
            purposeTitle: true,
            altegioTransactionId: true,
          },
        }),
  ]);

  const movements: CashBookMovement[] = [];

  for (const payment of payments) {
    const account = byId.get(payment.accountId);
    if (!account) continue;
    const code = String(payment.currencyCode || "").toUpperCase();
    const fx = payment.amountFx != null && payment.amountFx > 0 ? payment.amountFx : 0;
    const affectsFx = account.currency !== "UAH" && fx > 0 && code === account.currency;
    if (account.currency !== "UAH" && !affectsFx) continue;
    const amount = affectsFx ? money(fx) : money(payment.amount);
    if (!(amount > 0)) continue;
    movements.push({
      sourceType: "checkout_payment",
      sourceId: payment.id,
      accountId: account.id,
      accountTitle: payment.accountTitle || account.title,
      currency: account.currency,
      direction: "in",
      amount,
      kyivDay: payment.checkout.kyivDay,
      occurredAt: payment.checkout.createdAt,
      title: payment.checkout.appointment?.clientName?.trim() || "Оплата запису",
      recordId: payment.checkout.appointment?.altegioRecordId ?? payment.checkout.altegioRecordId ?? null,
      altegioTransactionId: payment.altegioTransactionId ?? null,
    });
  }

  for (const doc of documents) {
    const amount = money(doc.amountUah);
    if (!(amount > 0)) continue;
    const label = doc.title?.trim() || doc.purposeTitle?.trim() || "Документ";
    const push = (accountId: number | null | undefined, direction: "in" | "out", title: string | null | undefined) => {
      const id = Number(accountId) || 0;
      const account = byId.get(id);
      if (!account || account.currency !== "UAH") return;
      movements.push({
        sourceType: "finance_document",
        sourceId: doc.id,
        accountId: id,
        accountTitle: title?.trim() || account.title,
        currency: "UAH",
        direction,
        amount,
        kyivDay: doc.kyivDay,
        occurredAt: doc.occurredAt,
        title: label,
        recordId: null,
        altegioTransactionId: doc.altegioTransactionId ?? null,
      });
    };
    if (doc.type === "income") push(doc.accountId, "in", doc.accountTitle);
    else if (doc.type === "expense") push(doc.accountId, "out", doc.accountTitle);
    else if (doc.type === "transfer") {
      push(doc.accountId, "out", doc.accountTitle);
      push(doc.counterAccountId, "in", doc.counterAccountTitle);
    }
  }

  return movements;
}

function signed(movement: Pick<CashBookMovement, "direction" | "amount">): number {
  return movement.direction === "out" ? -movement.amount : movement.amount;
}

export async function openCashNetsForAccounts(
  accounts: Array<{ id: number; title: string; currency: CashCurrency }>,
): Promise<Map<number, { net: number; count: number }>> {
  const out = new Map<number, { net: number; count: number }>();
  if (accounts.length === 0) return out;
  const [movements, postings] = await Promise.all([
    loadCashBookMovements(accounts),
    prisma.cashTillPosting.findMany({
      where: { accountId: { in: accounts.map((account) => account.id) } },
      select: { sourceType: true, sourceId: true, accountId: true },
    }),
  ]);
  const posted = new Set(postings.map((row) => postingKey(row.sourceType, row.sourceId, row.accountId)));
  for (const movement of movements) {
    if (posted.has(postingKey(movement.sourceType, movement.sourceId, movement.accountId))) continue;
    const current = out.get(movement.accountId) || { net: 0, count: 0 };
    current.net = money(current.net + signed(movement));
    current.count += 1;
    out.set(movement.accountId, current);
  }
  return out;
}

export async function postCashMovementsIfMatched(input: {
  countId: string;
  accountId: number;
  accountTitle: string;
  currency: CashCurrency;
  counted: number;
  book: number;
}): Promise<{ matched: boolean; posted: number }> {
  const matched = cashAmountsEqual(input.counted, input.book);
  if (!matched) {
    console.log(
      `[finance/cash-posting] Каса ${input.accountId} «${input.accountTitle}»: факт ${input.counted} ≠ документи ${input.book}, проводки немає`,
    );
    return { matched: false, posted: 0 };
  }

  const movements = await loadCashBookMovements([
    { id: input.accountId, title: input.accountTitle, currency: input.currency },
  ]);
  const existing = await prisma.cashTillPosting.findMany({
    where: { accountId: input.accountId },
    select: { sourceType: true, sourceId: true, accountId: true },
  });
  const postedKeys = new Set(existing.map((row) => postingKey(row.sourceType, row.sourceId, row.accountId)));
  const fresh = movements.filter(
    (movement) =>
      movement.currency === input.currency
      && !postedKeys.has(postingKey(movement.sourceType, movement.sourceId, movement.accountId)),
  );

  await prisma.cashTillCount.update({
    where: { id: input.countId },
    data: { matchedBook: true },
  });

  if (fresh.length > 0) {
    await prisma.cashTillPosting.createMany({
      data: fresh.map((movement) => ({
        countId: input.countId,
        accountId: movement.accountId,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        direction: movement.direction,
        amount: movement.amount,
        kyivDay: movement.kyivDay,
      })),
      skipDuplicates: true,
    });
  }

  console.log(
    `[finance/cash-posting] Касовка ${input.countId} провела ${fresh.length} платежів каси ${input.accountId} «${input.accountTitle}» (${input.counted} ${input.currency})`,
  );
  return { matched: true, posted: fresh.length };
}

function kopToAmount(value: bigint): number {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const amount = Number(abs) / 100;
  return money(negative ? -amount : amount);
}

async function authorNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const users = await prisma.appUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  for (const user of users) map.set(user.id, user.name);
  return map;
}

export async function listCashLedger(): Promise<CashLedgerRow[]> {
  const { fetchAltegioAccounts } = await import("@/lib/altegio/accounts");
  const { hiddenFinanceAccountIds } = await import("@/lib/finance/account-archive");
  const [accounts, hiddenIds] = await Promise.all([fetchAltegioAccounts(), hiddenFinanceAccountIds()]);
  const cashAccounts = accounts
    .map((account) => ({
      id: Number(account.id) || 0,
      title: account.title,
      currency: currencyOfTitle(account.title),
    }))
    .filter((account) => account.id > 0 && isCashAltegioAccount(account.title) && !hiddenIds.has(account.id));

  const [movements, postings, altegioRows] = await Promise.all([
    loadCashBookMovements(cashAccounts),
    prisma.cashTillPosting.findMany({
      where: { accountId: { in: cashAccounts.map((account) => account.id) } },
      include: {
        count: {
          select: {
            id: true,
            kyivDay: true,
            countedUah: true,
            currency: true,
            createdAt: true,
            createdBy: true,
            matchedBook: true,
          },
        },
      },
    }),
    prisma.altegioFinanceTransaction.findMany({
      where: { deletedInAltegio: false, direction: { in: ["in", "out"] } },
      select: {
        altegioId: true,
        accountId: true,
        accountTitle: true,
        amountKopiykas: true,
        kyivDay: true,
        operationDate: true,
        direction: true,
        counterpartyName: true,
        paymentPurpose: true,
        comment: true,
      },
    }),
  ]);

  const names = await authorNames(
    postings.map((row) => row.count.createdBy || "").filter(Boolean),
  );
  const postingByKey = new Map(postings.map((row) => [postingKey(row.sourceType, row.sourceId, row.accountId), row]));
  const mirroredAltegioIds = new Set(
    movements
      .map((movement) => movement.altegioTransactionId)
      .filter((id): id is number => id != null && id > 0),
  );

  const rows: CashLedgerRow[] = movements.map((movement) => {
    const posting = postingByKey.get(postingKey(movement.sourceType, movement.sourceId, movement.accountId));
    const count = posting?.count;
    const author = count?.createdBy ? names.get(count.createdBy) || count.createdBy : "";
    return {
      id: postingKey(movement.sourceType, movement.sourceId, movement.accountId),
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      accountId: movement.accountId,
      accountTitle: movement.accountTitle,
      currency: movement.currency,
      direction: movement.direction,
      amount: movement.amount,
      kyivDay: movement.kyivDay,
      occurredAt: movement.occurredAt.toISOString(),
      title: movement.title,
      recordId: movement.recordId,
      posted: Boolean(posting) || movement.kyivDay < CASH_RECONCILE_FROM_KYIV_DAY,
      count: count
        ? {
            id: count.id,
            kyivDay: count.kyivDay,
            counted: count.countedUah,
            currency: count.currency,
            createdAt: count.createdAt.toISOString(),
            authorName: author,
          }
        : null,
    };
  });

  for (const tx of altegioRows) {
    const title = tx.accountTitle?.trim() || "";
    if (!isCashAltegioAccount(title)) continue;
    if (isDepositTopUpPaymentPurpose(tx.paymentPurpose || "")) continue;
    if (mirroredAltegioIds.has(tx.altegioId)) continue;
    const accountId = Number(tx.accountId) || 0;
    if (hiddenIds.has(accountId)) continue;
    const direction = tx.direction === "out" ? "out" : tx.direction === "in" ? "in" : null;
    if (!direction) continue;
    const raw = kopToAmount(tx.amountKopiykas);
    const amount = money(Math.abs(raw));
    if (!(amount > 0)) continue;
    rows.push({
      id: `altegio:${tx.altegioId}`,
      sourceType: "altegio",
      sourceId: String(tx.altegioId),
      accountId,
      accountTitle: title,
      currency: "UAH",
      direction,
      amount,
      kyivDay: tx.kyivDay,
      occurredAt: tx.operationDate.toISOString(),
      title: tx.counterpartyName?.trim() || tx.paymentPurpose?.trim() || tx.comment?.trim() || "Платіж Altegio",
      recordId: null,
      // До 09.10.2026 готівка вже в початковому залишку — у списку вона зведена без касовки.
      posted: tx.kyivDay < CASH_RECONCILE_FROM_KYIV_DAY,
      count: null,
    });
  }

  console.log(
    `[finance/cash-posting] Журнал готівки: ${movements.length} рухів Kresco, проведено ${postings.length}, рядків Altegio ${rows.length - movements.length}`,
  );
  return rows;
}
