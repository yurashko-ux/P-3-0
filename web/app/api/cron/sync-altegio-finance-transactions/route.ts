import { NextRequest, NextResponse } from "next/server";
import {
  ALTEGIO_FINANCE_SYNC_START_DATE,
  syncAltegioFinanceTransactions,
} from "@/lib/altegio/finance-transactions-sync";
import { syncBankOutgoingStatementsForReconciliation, refreshStaleHoldBankStatements } from "@/lib/bank/payment-reconciliation-sync";
import { reconcileBankAltegioPayments } from "@/lib/bank/altegio-payment-reconcile";
import { processOutgoingBankPaymentsHoldFinalized } from "@/lib/bank/payment-reconciliation-telegram";
import { importAltegioPaymentPurposes } from "@/lib/altegio/payment-purpose-import";
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

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dateFrom = req.nextUrl.searchParams.get("from") || ALTEGIO_FINANCE_SYNC_START_DATE;
    const dateTo = req.nextUrl.searchParams.get("to") || undefined;

    const altegio = await syncAltegioFinanceTransactions({ dateFrom, dateTo, syncPurposes: true });
    const purposes = await importAltegioPaymentPurposes({ dateFrom, dateTo, dryRun: false, maxPages: 5 });
    const staleHolds = await refreshStaleHoldBankStatements({ lookbackDays: 7, maxItems: 20 });
    const bank = await syncBankOutgoingStatementsForReconciliation({ from: dateFrom, to: dateTo, maxAccounts: 3 });
    const holdFinalizedIds = [...new Set([...staleHolds.holdFinalizedIds, ...bank.holdFinalizedIds])];
    const holdFinalized = await processOutgoingBankPaymentsHoldFinalized(holdFinalizedIds);
    const reconcile = await reconcileBankAltegioPayments({ from: dateFrom, to: dateTo, limit: 500 });
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

    return NextResponse.json({
      ok: true,
      altegio,
      purposes,
      staleHolds,
      bank,
      holdFinalized,
      reconcile,
      automaticAcquiring,
      automaticTerminal,
    });
  } catch (error) {
    console.error("[cron/sync-altegio-finance-transactions] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка cron синхронізації платежів" },
      { status: 500 },
    );
  }
}
