import { NextRequest, NextResponse } from "next/server";
import {
  ALTEGIO_FINANCE_SYNC_START_DATE,
  syncAltegioFinanceTransactions,
} from "@/lib/altegio/finance-transactions-sync";
import { syncBankOutgoingStatementsForReconciliation, refreshStaleHoldBankStatements } from "@/lib/bank/payment-reconciliation-sync";
import { reconcileBankAltegioPayments } from "@/lib/bank/altegio-payment-reconcile";
import { processOutgoingBankPaymentsHoldFinalized } from "@/lib/bank/payment-reconciliation-telegram";
import { importAltegioPaymentPurposes } from "@/lib/altegio/payment-purpose-import";
import {
  ensureKrescoDocumentsForAutomaticExpenses,
  ensureKrescoDocumentsForReconciledPayments,
} from "@/lib/bank/kresco-payment-document";
import { syncCheckoutPaymentsFromFinance } from "@/lib/journal/checkout-payments-from-finance";
import { persistMissingIncomingMatchesForBankItems } from "@/lib/bank/incoming-payment-reconcile";
import { prisma } from "@/lib/prisma";
import { processPendingIncomingAcquiringCommissions, processPendingOutgoingTerminalRkoFees } from "@/lib/bank/automatic-altegio-payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || "";
  const authHeader = req.headers.get("authorization");
  const secretParam = req.nextUrl.searchParams.get("secret");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  return Boolean(isVercelCron || (cronSecret && (authHeader === `Bearer ${cronSecret}` || secretParam === cronSecret)));
}

/** Скільки днів назад синхронізувати у звичайних (кожні 30 хв) запусках. */
const RECENT_SYNC_DAYS = 7;

/**
 * Повна синхронізація з ALTEGIO_FINANCE_SYNC_START_DATE — лише раз на добу
 * (перший запуск після 00:00 UTC ≈ 02:00–03:00 Київ). Решта запусків беруть
 * тільки останні RECENT_SYNC_DAYS днів, щоб не перезаписувати всю історію
 * в Prisma Postgres кожні 30 хвилин (це давало ~10 млн запитів/міс).
 */
function resolveDefaultDateFrom(now: Date = new Date()): string {
  const isNightlyFullSync = now.getUTCHours() === 0 && now.getUTCMinutes() < 30;
  if (isNightlyFullSync) return ALTEGIO_FINANCE_SYNC_START_DATE;
  const recent = new Date(now.getTime() - RECENT_SYNC_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return recent > ALTEGIO_FINANCE_SYNC_START_DATE ? recent : ALTEGIO_FINANCE_SYNC_START_DATE;
}

/**
 * Зведення вхідних, які розділ Платежі показує як «Зведені» лише live-оцінкою, записуємо в БД —
 * інакше Каса бачить їх незведеними, доки хтось не відкриє Банк або не натисне «Звести».
 * Раз на годину (перший запуск години) і лише за останні 3 дні, щоб не будувати preview кожні 30 хв.
 */
async function persistRecentIncomingMatches(now: Date = new Date()) {
  if (now.getUTCMinutes() >= 30) return { skipped: true };
  try {
    const items = await prisma.bankStatementItem.findMany({
      where: {
        amount: { gt: 0 },
        time: { gte: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
        paymentsHiddenAt: null,
        altegioIncomingMatch: null,
        altegioDepositMatch: null,
      },
      select: { id: true, time: true, amount: true, description: true, comment: true, counterName: true },
      take: 100,
    });
    const result = await persistMissingIncomingMatchesForBankItems(
      items.map((item) => ({ ...item, amount: BigInt(item.amount), description: item.description ?? "" })),
    );
    console.log("[cron/sync-altegio-finance-transactions] Зведення вхідних записано", { candidates: items.length, ...result });
    return result;
  } catch (error) {
    console.error("[cron/sync-altegio-finance-transactions] Не вдалося записати зведення вхідних:", error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dateFrom = req.nextUrl.searchParams.get("from") || resolveDefaultDateFrom();
    const dateTo = req.nextUrl.searchParams.get("to") || undefined;

    const altegio = await syncAltegioFinanceTransactions({ dateFrom, dateTo, syncPurposes: true });
    const purposes = await importAltegioPaymentPurposes({ dateFrom, dateTo, dryRun: false, maxPages: 5 });
    const staleHolds = await refreshStaleHoldBankStatements({ lookbackDays: 7, maxItems: 20 });
    const bank = await syncBankOutgoingStatementsForReconciliation({ from: dateFrom, to: dateTo, maxAccounts: 3 });
    const holdFinalizedIds = [...new Set([...staleHolds.holdFinalizedIds, ...bank.holdFinalizedIds])];
    const holdFinalized = await processOutgoingBankPaymentsHoldFinalized(holdFinalizedIds);
    const reconcile = await reconcileBankAltegioPayments({ from: dateFrom, to: dateTo, limit: 500 });
    // Документи Креско для зведених платежів (перехідний період: Altegio + Креско)
    const krescoDocuments = await ensureKrescoDocumentsForReconciledPayments(100);
    // Оплати чеків журналу по справжніх рахунках (з 08.11.2026)
    const checkoutPayments = await syncCheckoutPaymentsFromFinance();
    const automaticAcquiring = await processPendingIncomingAcquiringCommissions({
      lookbackDays: 3,
      limit: 20,
      sendTelegram: true,
    });
    const automaticTerminal = await processPendingOutgoingTerminalRkoFees({
      lookbackDays: 3,
      limit: 20,
      sendTelegram: true,
    });
    // Документи Креско для комісій еквайрингу (після того, як автоматика їх створила)
    const krescoFeeDocuments = await ensureKrescoDocumentsForAutomaticExpenses(100);
    const incomingPersist = await persistRecentIncomingMatches();

    return NextResponse.json({
      ok: true,
      altegio,
      purposes,
      staleHolds,
      bank,
      holdFinalized,
      reconcile,
      krescoDocuments,
      checkoutPayments,
      krescoFeeDocuments,
      automaticAcquiring,
      automaticTerminal,
      incomingPersist,
    });
  } catch (error) {
    console.error("[cron/sync-altegio-finance-transactions] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка cron синхронізації платежів" },
      { status: 500 },
    );
  }
}
