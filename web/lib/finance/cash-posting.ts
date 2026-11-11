// Готівкові рухи каси і фіксація касовки.
// Баланс каси = старт + усі рухи; касовка лише порівнює факт з балансом і записує розбіжність.
// Усі рухи до касовки позначаємо нею — це лише зв'язок для вкладки Готівка, на баланс не впливає.
// Рядки Altegio до дня старту в касовку не беремо: вони вже в початковому залишку.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCashAltegioAccount } from "@/lib/bank/incoming-reconcile-matching";
import { extractCurrencyAmountFromComment } from "@/lib/finance/encashment-account-bucket";
import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { isEurCashAccountTitle, isUsdCashAccountTitle } from "@/lib/journal/checkout";
import { BANK_DOCUMENT_SOURCE } from "@/lib/bank/bank-document-source";
import {
  CASH_LEDGER_HISTORY_FROM_KYIV_DAY,
  CASH_OPENING_KYIV_DAY,
  CASH_RECONCILE_FROM_KYIV_DAY,
} from "@/lib/finance/cash-openings";

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
  /** Візит Altegio: кілька записів (майстрів) одного візиту — один рядок у касі */
  visitId: number | null;
  altegioTransactionId: number | null;
  /** Переміщення: з якого рахунку на який */
  transferFrom?: string | null;
  transferTo?: string | null;
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
  clientName: string;
  recordId: number | null;
  visitId: number | null;
  posted: boolean;
  /** Переміщення: з якого рахунку на який */
  transferFrom?: string | null;
  transferTo?: string | null;
  /** Сума валюти взята за курсом дня (у коментарі Altegio її не було); null — точна сума */
  fxRate?: number | null;
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

/** Робочі курси (USD / EUR) по київських днях: свій день або найближчий попередній. Один запит. */
type WorkingRates = (kyivDay: string, currency: "USD" | "EUR") => number | null;

async function loadWorkingRates(days: string[]): Promise<WorkingRates> {
  const unique = [...new Set(days.filter(Boolean))].sort();
  if (unique.length === 0) return () => null;
  const rows = await prisma.dailyFxRate.findMany({
    where: { kyivDay: { lte: unique[unique.length - 1] } },
    orderBy: { kyivDay: "asc" },
    select: { kyivDay: true, usdWorking: true, eurWorking: true },
  });
  return (kyivDay, currency) => {
    let found: (typeof rows)[number] | null = null;
    for (const row of rows) {
      if (row.kyivDay > kyivDay) break;
      found = row;
    }
    const rate = found ? (currency === "USD" ? found.usdWorking : found.eurWorking) : 0;
    return rate > 0 ? rate : null;
  };
}

/**
 * Готівкова каса в гривні бере суму платежу.
 * Долар і євро — кількість валюти з коментаря Altegio (200$, 520Є), не гривневий еквівалент.
 * Немає суми в коментарі — гривні за робочим курсом дня платежу, до цілих (fxRate — курс, за яким рахували).
 */
function signedCashAmountFromAltegio(
  currency: CashCurrency,
  comment: string | null,
  amountKopiykas: bigint,
  altegioId: number,
  accountTitle: string,
  workingRate: number | null,
): { amount: number; fxRate: number | null } | null {
  const hryvnia = kopToAmount(amountKopiykas);
  if (currency === "UAH") return hryvnia === 0 ? null : { amount: hryvnia, fxRate: null };
  const sign = hryvnia < 0 ? -1 : 1;
  const foreign = extractCurrencyAmountFromComment(comment || "", currency === "USD" ? "usd" : "eur");
  if (foreign > 0) return { amount: money(sign * foreign), fxRate: null };
  if (workingRate && workingRate > 0 && hryvnia !== 0) {
    const converted = Math.round(Math.abs(hryvnia) / workingRate);
    console.warn(
      `[finance/cash-posting] Валютна каса «${accountTitle}»: у коментарі платежу ${altegioId} немає суми ${currency} («${comment || ""}») — ${hryvnia} грн за курсом ${workingRate} ≈ ${converted} ${currency}`,
    );
    return converted > 0 ? { amount: sign * converted, fxRate: workingRate } : null;
  }
  console.warn(
    `[finance/cash-posting] Валютна каса «${accountTitle}»: у коментарі платежу ${altegioId} немає суми ${currency} і немає курсу дня — платіж пропущено`,
  );
  return null;
}

/** Розбіжність менша за 5 копійок — той самий баланс, не надлишок і не недостача. */
export function cashAmountsEqual(a: number, b: number): boolean {
  return Math.abs(money(a) - money(b)) < 0.05;
}

export async function loadCashBookMovements(
  accounts: Array<{ id: number; title: string; currency: CashCurrency }>,
  /** Рухи після цього дня (за замовчуванням — після старту каси) */
  afterKyivDay: string = CASH_OPENING_KYIV_DAY,
): Promise<CashBookMovement[]> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const ids = accounts.map((account) => account.id);
  if (ids.length === 0) return [];

  const [payments, documents] = await Promise.all([
    prisma.salonCheckoutPayment.findMany({
      where: {
        accountId: { in: ids },
        checkout: { kyivDay: { gt: afterKyivDay } },
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
            altegioVisitId: true,
            appointment: { select: { clientName: true, altegioRecordId: true, altegioVisitId: true } },
          },
        },
      },
    }),
    prisma.financeDocument.findMany({
      where: {
        // Ручні документи Каси і документи зі зведення банку
        source: { in: ["kresco", BANK_DOCUMENT_SOURCE] },
        status: { not: "void" },
        kyivDay: { gt: afterKyivDay },
        OR: [{ accountId: { in: ids } }, { counterAccountId: { in: ids } }],
      },
      select: {
        id: true,
        type: true,
        amountUah: true,
        amountFx: true,
        counterAmountFx: true,
        comment: true,
        accountId: true,
        counterAccountId: true,
        accountTitle: true,
        counterAccountTitle: true,
        kyivDay: true,
        occurredAt: true,
        title: true,
        purposeTitle: true,
        altegioTransactionId: true,
        altegioCounterTransactionId: true,
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
      visitId: payment.checkout.appointment?.altegioVisitId ?? payment.checkout.altegioVisitId ?? null,
      altegioTransactionId: payment.altegioTransactionId ?? null,
    });
  }

  for (const doc of documents) {
    const base = doc.title?.trim() || doc.purposeTitle?.trim() || "Документ";
    const label = doc.comment?.trim() ? `${base} · ${doc.comment.trim()}` : base;
    const push = (
      accountId: number | null | undefined,
      direction: "in" | "out",
      title: string | null | undefined,
      fxAmount: number | null,
      altegioTransactionId: number | null,
    ) => {
      const id = Number(accountId) || 0;
      const account = byId.get(id);
      if (!account) return;
      // Гривнева каса бере гривні, валютна — кількість валюти з документа
      const amount = money(account.currency === "UAH" ? doc.amountUah : (fxAmount ?? 0));
      if (!(amount > 0)) return;
      movements.push({
        sourceType: "finance_document",
        sourceId: doc.id,
        accountId: id,
        accountTitle: title?.trim() || account.title,
        currency: account.currency,
        direction,
        amount,
        kyivDay: doc.kyivDay,
        occurredAt: doc.occurredAt,
        title: label,
        recordId: null,
        visitId: null,
        // Та сама операція Altegio не рахується вдруге (переміщення: друга нога має свій номер)
        altegioTransactionId,
        transferFrom: doc.type === "transfer" ? doc.accountTitle?.trim() || null : null,
        transferTo: doc.type === "transfer" ? doc.counterAccountTitle?.trim() || null : null,
      });
    };
    const sourceAltegioId = doc.altegioTransactionId ?? null;
    if (doc.type === "income") push(doc.accountId, "in", doc.accountTitle, doc.amountFx, sourceAltegioId);
    else if (doc.type === "expense") push(doc.accountId, "out", doc.accountTitle, doc.amountFx, sourceAltegioId);
    else if (doc.type === "transfer") {
      push(doc.accountId, "out", doc.accountTitle, doc.amountFx, sourceAltegioId);
      push(
        doc.counterAccountId,
        "in",
        doc.counterAccountTitle,
        doc.counterAmountFx,
        doc.altegioCounterTransactionId ?? sourceAltegioId,
      );
    }
  }

  return movements;
}

type FreshCashMovement = {
  key: string;
  sourceType: string;
  sourceId: string;
  accountId: number;
  direction: "in" | "out";
  amount: number;
  kyivDay: string;
};

export async function postCashCount(input: {
  countId: string;
  accountId: number;
  accountTitle: string;
  currency: CashCurrency;
  counted: number;
  /** Баланс плитки: старт + усі рухи. */
  previous: number;
}): Promise<{ matched: boolean; posted: number; expected: number; variance: number; book: number }> {
  const movements = await loadCashBookMovements([
    { id: input.accountId, title: input.accountTitle, currency: input.currency },
  ]);
  const existing = await prisma.cashTillPosting.findMany({
    where: { accountId: input.accountId },
    select: { sourceType: true, sourceId: true, accountId: true },
  });
  const postedKeys = new Set(existing.map((row) => postingKey(row.sourceType, row.sourceId, row.accountId)));
  const fresh: FreshCashMovement[] = movements
    .filter(
      (movement) =>
        movement.currency === input.currency
        && !postedKeys.has(postingKey(movement.sourceType, movement.sourceId, movement.accountId)),
    )
    .map((movement) => ({
      key: postingKey(movement.sourceType, movement.sourceId, movement.accountId),
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      accountId: movement.accountId,
      direction: movement.direction,
      amount: movement.amount,
      kyivDay: movement.kyivDay,
    }));
  const mirroredAltegioIds = new Set(
    movements.map((movement) => movement.altegioTransactionId).filter((id): id is number => id != null && id > 0),
  );
  const altegioFresh = await loadUnpostedAltegioCash(input.accountId, input.accountTitle, postedKeys, mirroredAltegioIds);
  for (const movement of altegioFresh) {
    fresh.push({
      key: postingKey("altegio", movement.sourceId, movement.accountId),
      sourceType: "altegio",
      sourceId: movement.sourceId,
      accountId: movement.accountId,
      direction: movement.direction,
      amount: movement.amount,
      kyivDay: movement.kyivDay,
    });
  }

  // previous — баланс плитки, що вже містить усі рухи з дня старту.
  const expected = money(input.previous);
  const rawVariance = money(input.counted - expected);
  const matched = cashAmountsEqual(input.counted, expected);
  const variance = matched ? 0 : rawVariance;
  const book = expected;

  await prisma.cashTillCount.update({
    where: { id: input.countId },
    data: {
      matchedBook: matched,
      expectedUah: expected,
      varianceUah: variance,
      bookUah: book,
    },
  });

  const toPost = fresh.map((movement) => ({
    countId: input.countId,
    accountId: movement.accountId,
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    direction: movement.direction,
    amount: movement.amount,
    kyivDay: movement.kyivDay,
  }));
  if (toPost.length > 0) {
    await prisma.cashTillPosting.createMany({
      data: toPost,
      skipDuplicates: true,
    });
  }

  const gapLabel = matched ? "збіг" : variance > 0 ? `надлишок ${variance}` : `недостача ${money(-variance)}`;
  console.log(
    `[finance/cash-posting] Касовка ${input.countId} каси ${input.accountId} «${input.accountTitle}»: факт ${input.counted}, очікувано ${expected}, ${gapLabel}. Позначено платежів ${toPost.length}, баланс плитки ${book} ${input.currency}`,
  );
  return { matched, posted: toPost.length, expected, variance, book };
}

type AltegioPostingRow = {
  sourceId: string;
  accountId: number;
  direction: "in" | "out";
  amount: number;
  kyivDay: string;
};

/** Готівкові платежі Altegio цієї каси з дня старту, яких ще немає в касовці. */
async function loadUnpostedAltegioCash(
  accountId: number,
  accountTitle: string,
  postedKeys: ReadonlySet<string>,
  mirroredAltegioIds: ReadonlySet<number>,
): Promise<AltegioPostingRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      altegioId: number;
      accountTitle: string | null;
      amountKopiykas: bigint;
      kyivDay: string;
      paymentPurpose: string | null;
      comment: string | null;
    }>
  >`
    SELECT "altegioId", "accountTitle", "amountKopiykas", "kyivDay", "paymentPurpose", "comment"
    FROM "altegio_finance_transactions"
    WHERE "deletedInAltegio" = false
      AND "kyivDay" >= ${CASH_RECONCILE_FROM_KYIV_DAY}
      AND "accountId" = ${String(accountId)}
  `;
  const out: AltegioPostingRow[] = [];
  const workingRate = await loadWorkingRates(rows.map((tx) => tx.kyivDay));
  for (const tx of rows) {
    const title = tx.accountTitle?.trim() || accountTitle;
    if (!isCashAltegioAccount(title)) continue;
    if (isDepositTopUpPaymentPurpose(tx.paymentPurpose || "")) continue;
    const altegioId = Number(tx.altegioId) || 0;
    if (!(altegioId > 0) || mirroredAltegioIds.has(altegioId)) continue;
    if (postedKeys.has(postingKey("altegio", String(altegioId), accountId))) continue;
    const currency = currencyOfTitle(title);
    const converted = signedCashAmountFromAltegio(
      currency,
      tx.comment,
      typeof tx.amountKopiykas === "bigint" ? tx.amountKopiykas : BigInt(tx.amountKopiykas),
      altegioId,
      title,
      currency === "UAH" ? null : workingRate(tx.kyivDay, currency),
    );
    if (converted == null) continue;
    const signedAmount = converted.amount;
    const amount = money(Math.abs(signedAmount));
    if (!(amount > 0)) continue;
    out.push({
      sourceId: String(altegioId),
      accountId,
      direction: signedAmount < 0 ? "out" : "in",
      amount,
      kyivDay: tx.kyivDay,
    });
  }
  return out;
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

type AltegioCashLedgerSource = {
  altegioId: number;
  accountId: string | null;
  accountTitle: string | null;
  amountKopiykas: bigint;
  kyivDay: string;
  operationDate: Date;
  paymentPurpose: string | null;
  comment: string | null;
  clientName: string | null;
  recordIdText: string | null;
  visitIdText: string | null;
};

/** Рахунок для розрахунку каси: id — номер рахунку Altegio (він же accountId в оплатах і документах). */
export type CashAccountRef = { id: string | number; title: string };

/** knownAccounts — готовий список рахунків (довідник Kresco); без нього список беремо з Altegio. */
export async function listCashLedger(knownAccounts?: CashAccountRef[]): Promise<CashLedgerRow[]> {
  const { fetchAltegioAccounts } = await import("@/lib/altegio/accounts");
  const { hiddenFinanceAccountIds } = await import("@/lib/finance/account-archive");
  const [accounts, hiddenIds] = await Promise.all([
    knownAccounts ?? fetchAltegioAccounts(),
    hiddenFinanceAccountIds(),
  ]);
  const cashAccounts = accounts
    .map((account) => ({
      id: Number(account.id) || 0,
      title: account.title,
      currency: currencyOfTitle(account.title),
    }))
    .filter((account) => account.id > 0 && isCashAltegioAccount(account.title) && !hiddenIds.has(account.id));

  const cashAccountIds = cashAccounts.map((account) => String(account.id));
  const [movements, postings, altegioRows] = await Promise.all([
    // Історія з 09.10 (у баланс каси плитки беруть лише рухи з дня старту)
    loadCashBookMovements(cashAccounts, "2026-10-08"),
    prisma.cashTillPosting.findMany({
      where: {
        accountId: { in: cashAccounts.map((account) => account.id) },
        kyivDay: { gte: CASH_LEDGER_HISTORY_FROM_KYIV_DAY },
      },
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
    // Готівка у вкладці — лише з 09.10.2026. Раніше вже в початковому залишку.
    cashAccountIds.length === 0
      ? Promise.resolve([] as AltegioCashLedgerSource[])
      : prisma.$queryRaw<AltegioCashLedgerSource[]>`
          SELECT
            "altegioId",
            "accountId",
            "accountTitle",
            "amountKopiykas",
            "kyivDay",
            "operationDate",
            "paymentPurpose",
            "comment",
            NULLIF(BTRIM("rawData"->'client'->>'name'), '') AS "clientName",
            NULLIF("rawData"->>'record_id', '') AS "recordIdText",
            NULLIF("rawData"->>'visit_id', '') AS "visitIdText"
          FROM "altegio_finance_transactions"
          WHERE "deletedInAltegio" = false
            AND "kyivDay" >= ${CASH_LEDGER_HISTORY_FROM_KYIV_DAY}
            AND "accountId" IN (${Prisma.join(cashAccountIds)})
        `,
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
      title: movement.sourceType === "checkout_payment" ? "Оплата запису" : movement.title,
      clientName: movement.sourceType === "checkout_payment" ? movement.title : "",
      recordId: movement.recordId,
      visitId: movement.visitId,
      transferFrom: movement.transferFrom ?? null,
      transferTo: movement.transferTo ?? null,
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

  const ledgerRate = await loadWorkingRates(altegioRows.map((tx) => tx.kyivDay));
  for (const tx of altegioRows) {
    const title = tx.accountTitle?.trim() || "";
    if (!isCashAltegioAccount(title)) continue;
    if (isDepositTopUpPaymentPurpose(tx.paymentPurpose || "")) continue;
    if (mirroredAltegioIds.has(tx.altegioId)) continue;
    const accountId = Number(tx.accountId) || 0;
    if (hiddenIds.has(accountId)) continue;
    const currency = currencyOfTitle(title);
    const converted = signedCashAmountFromAltegio(
      currency,
      tx.comment,
      typeof tx.amountKopiykas === "bigint" ? tx.amountKopiykas : BigInt(tx.amountKopiykas),
      tx.altegioId,
      title,
      currency === "UAH" ? null : ledgerRate(tx.kyivDay, currency),
    );
    if (converted == null) continue;
    const signedAmount = converted.amount;
    const amount = money(Math.abs(signedAmount));
    if (!(amount > 0)) continue;
    // Знак суми — реальний рух каси. direction у базі хибний: стаття «Надання послуг» записана як витрата.
    const direction = signedAmount < 0 ? "out" : "in";
    const clientName = tx.clientName?.trim() || "";
    const recordId = Number(tx.recordIdText);
    const visitId = Number(tx.visitIdText);
    const posting = postingByKey.get(postingKey("altegio", String(tx.altegioId), accountId));
    const count = posting?.count;
    const author = count?.createdBy ? names.get(count.createdBy) || count.createdBy : "";
    rows.push({
      id: `altegio:${tx.altegioId}`,
      sourceType: "altegio",
      sourceId: String(tx.altegioId),
      accountId,
      accountTitle: title,
      currency,
      direction,
      amount,
      kyivDay: tx.kyivDay,
      occurredAt: tx.operationDate.toISOString(),
      title: tx.paymentPurpose?.trim() || tx.comment?.trim() || "Платіж Altegio",
      clientName,
      recordId: Number.isFinite(recordId) && recordId > 0 ? recordId : null,
      visitId: Number.isFinite(visitId) && visitId > 0 ? visitId : null,
      posted: Boolean(posting),
      fxRate: converted.fxRate,
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
    });
  }

  console.log(
    `[finance/cash-posting] Журнал готівки: ${movements.length} рухів Kresco, проведено ${postings.length}, рядків Altegio ${rows.length - movements.length}`,
  );
  return rows;
}
