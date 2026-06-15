import { prisma } from "@/lib/prisma";
import {
  ALTEGIO_FINANCE_SYNC_START_DATE,
  normalizePaymentPurposeTitle,
} from "@/lib/altegio/finance-transactions-sync";

export type ReconcileBankAltegioPaymentsResult = {
  checked: number;
  autoMatched: number;
  awaitingAltegioDocument: number;
  needsReview: number;
  conflicts: number;
  skipped: number;
};

const AUTO_MATCH_THRESHOLD = 90;

function parseDate(value?: string): Date {
  const parsed = value ? new Date(value) : new Date(`${ALTEGIO_FINANCE_SYNC_START_DATE}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(`${ALTEGIO_FINANCE_SYNC_START_DATE}T00:00:00.000Z`) : parsed;
}

function kyivDayFromDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function textTokens(value: unknown): Set<string> {
  return new Set(
    normalizePaymentPurposeTitle(String(value || ""))
      .split(" ")
      .filter((token) => token.length >= 3),
  );
}

function textScore(bankTexts: unknown[], altegioTexts: unknown[]): number {
  const bankTokens = textTokens(bankTexts.filter(Boolean).join(" "));
  const altegioTokens = textTokens(altegioTexts.filter(Boolean).join(" "));
  if (!bankTokens.size || !altegioTokens.size) return 0;

  let overlap = 0;
  for (const token of bankTokens) {
    if (altegioTokens.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;
  const ratio = overlap / Math.min(bankTokens.size, altegioTokens.size);
  if (ratio >= 0.75) return 20;
  if (ratio >= 0.45) return 12;
  return 6;
}

function absBigint(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function scoreCandidate(statement: any, candidate: any, pendingPurposeTitle?: string | null): number {
  let score = 0;
  if (absBigint(BigInt(statement.amount)) === absBigint(BigInt(candidate.amountKopiykas))) score += 40;
  if (String(statement.account?.altegioAccountId || "") === String(candidate.accountId || "")) score += 25;
  if (kyivDayFromDate(statement.time) === candidate.kyivDay) score += 20;

  const textBonus = textScore(
    [statement.comment, statement.counterName, pendingPurposeTitle],
    [candidate.paymentPurpose, candidate.comment, candidate.categoryTitle, candidate.counterpartyName],
  );
  score += textBonus;

  if (pendingPurposeTitle) {
    const pending = normalizePaymentPurposeTitle(pendingPurposeTitle);
    const candidatePurpose = normalizePaymentPurposeTitle(
      [candidate.paymentPurpose, candidate.categoryTitle, candidate.comment].filter(Boolean).join(" "),
    );
    if (pending && candidatePurpose.includes(pending)) score += 20;
  }

  return Math.min(score, 100);
}

function isTransferPendingPurpose(value: string | null | undefined): boolean {
  return normalizePaymentPurposeTitle(value || "").startsWith("переміщення");
}

async function upsertMatch(params: {
  bankStatementItemId: string;
  altegioFinanceTransactionId?: string | null;
  status: string;
  matchType: string;
  matchScore?: number | null;
  matchedBy?: string | null;
  reviewNote?: string | null;
  conflictData?: object | null;
}) {
  return (prisma as any).bankAltegioPaymentMatch.upsert({
    where: { bankStatementItemId: params.bankStatementItemId },
    create: {
      bankStatementItemId: params.bankStatementItemId,
      altegioFinanceTransactionId: params.altegioFinanceTransactionId ?? null,
      status: params.status,
      matchType: params.matchType,
      matchScore: params.matchScore ?? null,
      matchedAt: params.status === "auto_matched" || params.status === "manual_matched" ? new Date() : null,
      matchedBy: params.matchedBy ?? null,
      reviewNote: params.reviewNote ?? null,
      conflictData: params.conflictData ?? null,
    },
    update: {
      altegioFinanceTransactionId: params.altegioFinanceTransactionId ?? null,
      status: params.status,
      matchType: params.matchType,
      matchScore: params.matchScore ?? null,
      matchedAt: params.status === "auto_matched" || params.status === "manual_matched" ? new Date() : null,
      matchedBy: params.matchedBy ?? null,
      reviewNote: params.reviewNote ?? null,
      conflictData: params.conflictData ?? null,
    },
  });
}

export async function reconcileBankAltegioPayments(params: {
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<ReconcileBankAltegioPaymentsResult> {
  const from = parseDate(params.from);
  const to = params.to ? parseDate(params.to) : new Date();
  const limit = Math.max(1, Math.min(params.limit ?? 500, 2000));

  const statements = await prisma.bankStatementItem.findMany({
    where: {
      time: { gte: from, lte: to },
      amount: { lt: 0 },
      hold: false,
      account: {
        altegioAccountId: { not: null },
        includeInOperationsTable: true,
      },
    },
    include: {
      account: { select: { id: true, altegioAccountId: true, altegioAccountTitle: true } },
      altegioPaymentMatch: true,
    },
    orderBy: { time: "desc" },
    take: limit,
  });

  const result: ReconcileBankAltegioPaymentsResult = {
    checked: 0,
    autoMatched: 0,
    awaitingAltegioDocument: 0,
    needsReview: 0,
    conflicts: 0,
    skipped: 0,
  };

  for (const statement of statements as any[]) {
    result.checked += 1;
    const existing = statement.altegioPaymentMatch;
    if (existing && ["auto_matched", "manual_matched", "ignored"].includes(existing.status)) {
      result.skipped += 1;
      continue;
    }

    const pending = await (prisma as any).bankAltegioPendingPayment.findUnique({
      where: { bankStatementItemId: statement.id },
      select: { id: true, purposeTitle: true, status: true },
    });

    const amount = absBigint(BigInt(statement.amount));
    const dateFrom = addDays(statement.time, -2);
    const dateTo = addDays(statement.time, 2);
    const isTransferPending = isTransferPendingPurpose(pending?.purposeTitle);
    const candidates = await (prisma as any).altegioFinanceTransaction.findMany({
      where: {
        accountId: String(statement.account.altegioAccountId),
        direction: isTransferPending ? { in: ["out", "transfer"] } : "out",
        deletedInAltegio: false,
        operationDate: { gte: dateFrom, lte: dateTo },
        OR: [{ amountKopiykas: amount }, { amountKopiykas: -amount }],
        bankPaymentMatch: null,
      },
      orderBy: { operationDate: "desc" },
      take: 20,
    });

    const scored = candidates
      .map((candidate: any) => ({
        candidate,
        score: scoreCandidate(statement, candidate, pending?.purposeTitle ?? null),
      }))
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

    const strong = scored.filter((item: { score: number }) => item.score >= AUTO_MATCH_THRESHOLD);

    if (strong.length === 1) {
      const match = await upsertMatch({
        bankStatementItemId: statement.id,
        altegioFinanceTransactionId: strong[0].candidate.id,
        status: "auto_matched",
        matchType: pending ? "telegram" : "auto",
        matchScore: strong[0].score,
        matchedBy: pending ? "telegram_pending_payment" : "reconcile_engine",
        reviewNote: pending ? "Автоматично прив'язано після вибору призначення в Telegram" : null,
      });
      if (pending) {
        await (prisma as any).bankAltegioPendingPayment.update({
          where: { id: pending.id },
          data: { status: "linked", linkedMatchId: match.id },
        });
      }
      result.autoMatched += 1;
      continue;
    }

    if (strong.length > 1 || scored.length > 1) {
      await upsertMatch({
        bankStatementItemId: statement.id,
        status: "conflict",
        matchType: "system",
        matchScore: scored[0]?.score ?? null,
        reviewNote: "Знайдено кілька можливих платежів Altegio з однаковою сумою/датою",
        conflictData: {
          candidates: scored.slice(0, 5).map((item: any) => ({
            id: item.candidate.id,
            altegioId: item.candidate.altegioId,
            score: item.score,
            operationDate: item.candidate.operationDate,
            paymentPurpose: item.candidate.paymentPurpose,
            categoryTitle: item.candidate.categoryTitle,
          })),
        },
      });
      result.conflicts += 1;
      continue;
    }

    if (pending?.status === "awaiting_altegio_document") {
      await upsertMatch({
        bankStatementItemId: statement.id,
        status: "awaiting_altegio_document",
        matchType: "telegram",
        reviewNote: `Очікуємо документ Altegio для призначення: ${pending.purposeTitle}`,
      });
      result.awaitingAltegioDocument += 1;
      continue;
    }

    await upsertMatch({
      bankStatementItemId: statement.id,
      status: "needs_review",
      matchType: "system",
      reviewNote: "Не знайдено відповідного платежу Altegio",
    });
    result.needsReview += 1;
  }

  console.log("[bank/altegio-payment-reconcile] Зведення завершено", result);
  return result;
}

export async function manualMatchBankAltegioPayment(params: {
  bankStatementItemId: string;
  altegioFinanceTransactionId: string;
  matchedBy?: string | null;
}) {
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: params.bankStatementItemId },
    include: { account: { select: { altegioAccountId: true } } },
  });
  const altegioTransaction = await (prisma as any).altegioFinanceTransaction.findUnique({
    where: { id: params.altegioFinanceTransactionId },
  });

  if (!statement || !altegioTransaction) {
    throw new Error("Банківську операцію або платіж Altegio не знайдено");
  }
  if (statement.hold) {
    throw new Error("Hold-операцію не можна зводити до фіналізації");
  }
  if (BigInt(statement.amount) >= 0n) {
    throw new Error("Зведення підтримує лише вихідні банківські платежі");
  }
  if (String(statement.account.altegioAccountId || "") !== String(altegioTransaction.accountId || "")) {
    throw new Error("Рахунок Altegio у банківській операції і платежі не збігається");
  }
  if (absBigint(BigInt(statement.amount)) !== absBigint(BigInt(altegioTransaction.amountKopiykas))) {
    throw new Error("Сума банківського переказу і платежу Altegio не збігається");
  }

  return upsertMatch({
    bankStatementItemId: params.bankStatementItemId,
    altegioFinanceTransactionId: params.altegioFinanceTransactionId,
    status: "manual_matched",
    matchType: "manual",
    matchScore: 100,
    matchedBy: params.matchedBy ?? "admin",
  });
}

export async function unmatchBankAltegioPayment(bankStatementItemId: string) {
  return (prisma as any).bankAltegioPaymentMatch.update({
    where: { bankStatementItemId },
    data: {
      altegioFinanceTransactionId: null,
      status: "needs_review",
      matchType: "manual",
      matchScore: null,
      matchedAt: null,
      matchedBy: null,
      reviewNote: "Зв'язок вручну знято",
    },
  });
}

export async function ignoreBankAltegioPayment(bankStatementItemId: string, note?: string) {
  return upsertMatch({
    bankStatementItemId,
    status: "ignored",
    matchType: "manual",
    reviewNote: note || "Операцію вручну виключено зі зведення",
  });
}
