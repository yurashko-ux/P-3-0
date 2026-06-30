import { prisma } from "@/lib/prisma";
import {
  createIncomingAcquiringExpense,
  createAutomaticTerminalExpense,
} from "@/lib/altegio/finance-transactions-create";
import {
  classifyIncomingBankRow,
  parseBankCommission,
} from "@/lib/bank/incoming-altegio-aggregate";
import {
  isTerminalRkoBankPayment,
  parseRkoKyivMonthFromText,
} from "@/lib/bank/bank-outgoing-classify";
import { sendAutomaticAltegioPaymentTelegramReport } from "@/lib/bank/automatic-altegio-payments-telegram";

export type AutomaticAltegioExpenseKind = "acquiring_commission" | "terminal_fee";

export type ProcessAutomaticPaymentResult = {
  processed: boolean;
  skipped: boolean;
  reason?: string;
  expenseId?: string;
  altegioTransactionId?: number;
  reusedExisting?: boolean;
  telegramSent?: number;
};

export type ProcessAutomaticPaymentsBatchResult = {
  acquiring: {
    scanned: number;
    created: number;
    skipped: number;
    failed: number;
    details: ProcessAutomaticPaymentResult[];
  };
  terminal: {
    scanned: number;
    created: number;
    skipped: number;
    failed: number;
    details: ProcessAutomaticPaymentResult[];
  };
};

function accountDisplayTitle(account: {
  altegioAccountTitle: string | null;
  maskedPan: string | null;
  iban: string | null;
  connection?: { clientName: string | null; name: string | null } | null;
}): string {
  const last4 = (account.maskedPan || account.iban || "").replace(/\s+/g, "").slice(-4);
  const fop = account.connection?.clientName || account.connection?.name || account.altegioAccountTitle || "Рахунок";
  return last4 ? `${fop} (${last4})` : fop;
}

/** Текст банківського платежу для коментаря в Altegio. */
export function buildBankPaymentComment(statement: {
  description: string;
  comment: string | null;
  counterName?: string | null;
}): string {
  const purpose = [statement.comment?.trim(), statement.description?.trim()].filter(Boolean).join(" ").trim();
  const counter = statement.counterName?.trim();
  if (counter && purpose) return `${counter}\n${purpose}`;
  return counter || purpose;
}

async function markAutomaticExpenseFailed(id: string, errorMessage: string): Promise<void> {
  await (prisma as any).bankAutomaticAltegioExpense.update({
    where: { id },
    data: {
      status: "failed",
      errorMessage: errorMessage.slice(0, 2000),
    },
  });
}

async function notifyAutomaticExpense(
  expenseId: string,
  report: Parameters<typeof sendAutomaticAltegioPaymentTelegramReport>[0],
): Promise<number> {
  const telegram = await sendAutomaticAltegioPaymentTelegramReport(report);
  if (telegram.sent > 0) {
    await (prisma as any).bankAutomaticAltegioExpense.update({
      where: { id: expenseId },
      data: { telegramNotifiedAt: new Date() },
    });
  }
  return telegram.sent;
}

/**
 * Створює вихідний платіж «Комісія за еквайринг» при надходженні еквайрингу.
 * Ідемпотентно: повторний виклик для того ж bankStatementItemId не дублює платіж.
 */
export async function processIncomingAcquiringCommission(
  bankStatementItemId: string,
  options: { sendTelegram?: boolean } = {},
): Promise<ProcessAutomaticPaymentResult> {
  const sendTelegram = options.sendTelegram !== false;

  const existing = await (prisma as any).bankAutomaticAltegioExpense.findUnique({
    where: { bankStatementItemId },
    select: {
      id: true,
      status: true,
      altegioFinanceTransactionId: true,
      altegioTransactionId: true,
    },
  });

  if (existing?.status === "created") {
    return {
      processed: true,
      skipped: true,
      reason: "already_created",
      expenseId: existing.id,
      altegioTransactionId: existing.altegioTransactionId ?? undefined,
    };
  }

  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: bankStatementItemId },
    include: {
      account: {
        select: {
          id: true,
          altegioAccountId: true,
          altegioAccountTitle: true,
          maskedPan: true,
          iban: true,
          includeInOperationsTable: true,
          connection: { select: { clientName: true, name: true } },
        },
      },
    },
  });

  if (!statement) return { processed: false, skipped: true, reason: "statement_not_found" };
  if (statement.amount <= 0n) return { processed: false, skipped: true, reason: "not_incoming" };
  if (!statement.account.includeInOperationsTable) return { processed: false, skipped: true, reason: "account_excluded" };
  if (!statement.account.altegioAccountId) return { processed: false, skipped: true, reason: "no_altegio_account" };

  const kind = classifyIncomingBankRow({
    description: statement.description,
    comment: statement.comment,
    counterName: statement.counterName,
  });
  if (kind !== "universal_bank_aggregate") return { processed: false, skipped: true, reason: "not_acquiring" };

  const text = `${statement.description || ""} ${statement.comment || ""}`;
  const commission = parseBankCommission(text);
  if (!commission.kopiykas || commission.kopiykas <= 0n) {
    return { processed: false, skipped: true, reason: "no_commission" };
  }

  const bankComment = buildBankPaymentComment(statement);
  const accountTitle = accountDisplayTitle(statement.account);

  let expenseRecord = existing;
  if (!expenseRecord) {
    expenseRecord = await (prisma as any).bankAutomaticAltegioExpense.create({
      data: {
        kind: "acquiring_commission",
        bankStatementItemId,
        bankAccountId: statement.account.id,
        amountKopiykas: commission.kopiykas,
        comment: bankComment || null,
        status: "pending",
      },
      select: {
        id: true,
        status: true,
        altegioFinanceTransactionId: true,
        altegioTransactionId: true,
      },
    });
  }

  try {
    const expense = await createIncomingAcquiringExpense({
      bankStatementItemId,
      commissionKopiykas: commission.kopiykas,
      comment: bankComment || "Еквайринг",
      expenseDate: statement.time,
      matchedBy: "automatic_acquiring",
    });

    await (prisma as any).bankAutomaticAltegioExpense.update({
      where: { id: expenseRecord.id },
      data: {
        status: "created",
        errorMessage: null,
        altegioFinanceTransactionId: expense.transaction.id,
        altegioTransactionId: expense.transaction.altegioId,
      },
    });

    let telegramSent = 0;
    if (sendTelegram) {
      telegramSent = await notifyAutomaticExpense(expenseRecord.id, {
        kind: "acquiring_commission",
        accountTitle,
        amountKopiykas: commission.kopiykas,
        comment: bankComment || null,
        altegioTransactionId: expense.transaction.altegioId,
        bankStatementItemId,
        reusedExisting: expense.reusedExisting,
      });
    }

    console.log("[automatic-altegio-payments] Комісія еквайрингу створена", {
      bankStatementItemId,
      altegioId: expense.transaction.altegioId,
      commissionKop: commission.kopiykas.toString(),
    });

    return {
      processed: true,
      skipped: false,
      expenseId: expenseRecord.id,
      altegioTransactionId: expense.transaction.altegioId,
      reusedExisting: expense.reusedExisting,
      telegramSent,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markAutomaticExpenseFailed(expenseRecord.id, message);

    if (sendTelegram) {
      await notifyAutomaticExpense(expenseRecord.id, {
        kind: "acquiring_commission",
        accountTitle,
        amountKopiykas: commission.kopiykas,
        comment: bankComment || null,
        altegioTransactionId: null,
        bankStatementItemId,
        errorMessage: message,
      });
    }

    return { processed: false, skipped: false, reason: message, expenseId: expenseRecord.id };
  }
}

/**
 * Створює вихідний платіж «Термінал» при списанні комісії за РКО Universal Bank.
 * Ідемпотентно за bankStatementItemId.
 */
export async function processOutgoingTerminalRkoFee(
  bankStatementItemId: string,
  options: { sendTelegram?: boolean } = {},
): Promise<ProcessAutomaticPaymentResult> {
  const sendTelegram = options.sendTelegram !== false;

  const existing = await (prisma as any).bankAutomaticAltegioExpense.findUnique({
    where: { bankStatementItemId },
    select: {
      id: true,
      status: true,
      altegioFinanceTransactionId: true,
      altegioTransactionId: true,
    },
  });

  if (existing?.status === "created") {
    return {
      processed: true,
      skipped: true,
      reason: "already_created",
      expenseId: existing.id,
      altegioTransactionId: existing.altegioTransactionId ?? undefined,
    };
  }

  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: bankStatementItemId },
    include: {
      account: {
        select: {
          id: true,
          altegioAccountId: true,
          altegioAccountTitle: true,
          maskedPan: true,
          iban: true,
          includeInOperationsTable: true,
          connection: { select: { clientName: true, name: true } },
        },
      },
    },
  });

  if (!statement) return { processed: false, skipped: true, reason: "statement_not_found" };
  if (statement.amount >= 0n) return { processed: false, skipped: true, reason: "not_outgoing" };
  if (!statement.account.includeInOperationsTable) return { processed: false, skipped: true, reason: "account_excluded" };
  if (!statement.account.altegioAccountId) return { processed: false, skipped: true, reason: "no_altegio_account" };

  if (!isTerminalRkoBankPayment({
    description: statement.description,
    comment: statement.comment,
    counterName: statement.counterName,
    amount: statement.amount,
  })) {
    return { processed: false, skipped: true, reason: "not_terminal_rko" };
  }

  const amountKop = -statement.amount;
  const bankComment = buildBankPaymentComment(statement);
  const accountTitle = accountDisplayTitle(statement.account);
  const paymentText = `${statement.comment || ""} ${statement.description || ""}`;
  const kyivMonth = parseRkoKyivMonthFromText(paymentText);

  let expenseRecord = existing;
  if (!expenseRecord) {
    expenseRecord = await (prisma as any).bankAutomaticAltegioExpense.create({
      data: {
        kind: "terminal_fee",
        bankStatementItemId,
        bankAccountId: statement.account.id,
        kyivMonth,
        amountKopiykas: amountKop,
        comment: bankComment || null,
        status: "pending",
      },
      select: {
        id: true,
        status: true,
        altegioFinanceTransactionId: true,
        altegioTransactionId: true,
      },
    });
  }

  try {
    const expense = await createAutomaticTerminalExpense({
      bankStatementItemId,
      amountKopiykas: amountKop,
      comment: bankComment || "Комісія за РКО",
      expenseDate: statement.time,
      matchedBy: "automatic_terminal_rko",
    });

    await (prisma as any).bankAutomaticAltegioExpense.update({
      where: { id: expenseRecord.id },
      data: {
        status: "created",
        errorMessage: null,
        altegioFinanceTransactionId: expense.transaction.id,
        altegioTransactionId: expense.transaction.altegioId,
      },
    });

    let telegramSent = 0;
    if (sendTelegram) {
      telegramSent = await notifyAutomaticExpense(expenseRecord.id, {
        kind: "terminal_fee",
        accountTitle,
        amountKopiykas: amountKop,
        comment: bankComment || null,
        altegioTransactionId: expense.transaction.altegioId,
        bankStatementItemId,
        kyivMonth,
        reusedExisting: expense.reusedExisting,
      });
    }

    console.log("[automatic-altegio-payments] Термінал (РКО) створено", {
      bankStatementItemId,
      altegioId: expense.transaction.altegioId,
      amountKop: amountKop.toString(),
      kyivMonth,
    });

    return {
      processed: true,
      skipped: false,
      expenseId: expenseRecord.id,
      altegioTransactionId: expense.transaction.altegioId,
      reusedExisting: expense.reusedExisting,
      telegramSent,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markAutomaticExpenseFailed(expenseRecord.id, message);

    if (sendTelegram) {
      await notifyAutomaticExpense(expenseRecord.id, {
        kind: "terminal_fee",
        accountTitle,
        amountKopiykas: amountKop,
        comment: bankComment || null,
        altegioTransactionId: null,
        bankStatementItemId,
        kyivMonth,
        errorMessage: message,
      });
    }

    return { processed: false, skipped: false, reason: message, expenseId: expenseRecord.id };
  }
}

/** Чи це автоматичний платіж (еквайринг або РКО), що не потребує ручного зведення. */
export async function isAutomaticBankPayment(bankStatementItemId: string): Promise<boolean> {
  const statement = await prisma.bankStatementItem.findUnique({
    where: { id: bankStatementItemId },
    select: {
      amount: true,
      description: true,
      comment: true,
      counterName: true,
    },
  });
  if (!statement) return false;

  if (statement.amount > 0n) {
    const kind = classifyIncomingBankRow({
      description: statement.description,
      comment: statement.comment,
      counterName: statement.counterName,
    });
    if (kind !== "universal_bank_aggregate") return false;
    const commission = parseBankCommission(`${statement.description} ${statement.comment || ""}`);
    return Boolean(commission.kopiykas && commission.kopiykas > 0n);
  }

  return isTerminalRkoBankPayment({
    description: statement.description,
    comment: statement.comment,
    counterName: statement.counterName,
    amount: statement.amount,
  });
}

/** Fallback: пропущені вхідні еквайринги за останні дні. */
export async function processPendingIncomingAcquiringCommissions(params: {
  lookbackDays?: number;
  limit?: number;
  sendTelegram?: boolean;
} = {}): Promise<{
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
  details: ProcessAutomaticPaymentResult[];
}> {
  const lookbackDays = Math.max(1, params.lookbackDays ?? 14);
  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const statements = await prisma.bankStatementItem.findMany({
    where: {
      time: { gte: from },
      amount: { gt: 0n },
      account: { includeInOperationsTable: true },
      automaticAltegioExpense: null,
    },
    orderBy: { time: "desc" },
    take: limit,
    select: { id: true },
  });

  const details: ProcessAutomaticPaymentResult[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of statements) {
    const result = await processIncomingAcquiringCommission(row.id, {
      sendTelegram: params.sendTelegram,
    });
    details.push(result);
    if (result.skipped) skipped += 1;
    else if (result.processed) created += 1;
    else failed += 1;
  }

  return { scanned: statements.length, created, skipped, failed, details };
}

/** Fallback: пропущені вихідні РКО (термінал) за останні дні. */
export async function processPendingOutgoingTerminalRkoFees(params: {
  lookbackDays?: number;
  limit?: number;
  sendTelegram?: boolean;
} = {}): Promise<{
  scanned: number;
  created: number;
  skipped: number;
  failed: number;
  details: ProcessAutomaticPaymentResult[];
}> {
  const lookbackDays = Math.max(1, params.lookbackDays ?? 14);
  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const statements = await prisma.bankStatementItem.findMany({
    where: {
      time: { gte: from },
      amount: { lt: 0n },
      account: { includeInOperationsTable: true },
      automaticAltegioExpense: null,
    },
    orderBy: { time: "desc" },
    take: limit,
    select: {
      id: true,
      description: true,
      comment: true,
      counterName: true,
      amount: true,
    },
  });

  const details: ProcessAutomaticPaymentResult[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let scanned = 0;

  for (const row of statements) {
    if (!isTerminalRkoBankPayment(row)) continue;
    scanned += 1;
    const result = await processOutgoingTerminalRkoFee(row.id, {
      sendTelegram: params.sendTelegram,
    });
    details.push(result);
    if (result.skipped) skipped += 1;
    else if (result.processed) created += 1;
    else failed += 1;
  }

  return { scanned, created, skipped, failed, details };
}

/** Запуск усіх автоматичних платежів (cron / адмін). */
export async function runAutomaticAltegioPayments(params: {
  acquiring?: boolean;
  terminal?: boolean;
  lookbackDays?: number;
  sendTelegram?: boolean;
} = {}): Promise<ProcessAutomaticPaymentsBatchResult> {
  const acquiring = params.acquiring !== false
    ? await processPendingIncomingAcquiringCommissions({
        lookbackDays: params.lookbackDays,
        sendTelegram: params.sendTelegram,
      })
    : { scanned: 0, created: 0, skipped: 0, failed: 0, details: [] };

  const terminal = params.terminal !== false
    ? await processPendingOutgoingTerminalRkoFees({
        lookbackDays: params.lookbackDays,
        sendTelegram: params.sendTelegram,
      })
    : { scanned: 0, created: 0, skipped: 0, failed: 0, details: [] };

  return { acquiring, terminal };
}

/** Для зведення вхідних: ID транзакції Altegio, якщо комісія вже створена автоматично. */
export async function findAutomaticAcquiringExpenseTransactionId(
  bankStatementItemId: string,
): Promise<string | null> {
  const row = await (prisma as any).bankAutomaticAltegioExpense.findUnique({
    where: { bankStatementItemId },
    select: { status: true, altegioFinanceTransactionId: true, kind: true },
  });
  if (!row || row.status !== "created" || row.kind !== "acquiring_commission") return null;
  if (!row.altegioFinanceTransactionId) return null;
  return row.altegioFinanceTransactionId;
}
