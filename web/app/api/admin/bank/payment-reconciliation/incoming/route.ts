import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { buildIncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import {
  loadDepositIncomingMatches,
  syncDepositIncomingMatches,
} from "@/lib/bank/deposit-incoming-reconcile";
import { syncExactOpenPairsFromPreview } from "@/lib/bank/incoming-payment-reconcile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Preview + запис лише точних пар; не повинен вимагати 300s. */
export const maxDuration = 120;

/** Швидке читання preview + збережені матчі (без автозведення та Altegio deposits). */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const startedAt = Date.now();
    // Live 21 день лише /transactions (без documents/records) + історія з БД.
    const preview = await buildIncomingReconciliationPreview({
      liveLookbackDays: 21,
      skipDocumentEnrichment: true,
    });

    const [incomingMatches, depositMatches] = await Promise.all([
      (prisma as any).bankAltegioIncomingMatch.findMany({
        select: {
          id: true,
          bankStatementItemId: true,
          kyivDay: true,
          status: true,
          matchType: true,
          matchedAt: true,
          matchedBy: true,
          reviewNote: true,
          acquiringExpenseTransactionId: true,
        },
        orderBy: { matchedAt: "desc" },
      }),
      loadDepositIncomingMatches(),
    ]);

    const depositBankItemIds = depositMatches
      .map((match) => match.bankStatementItemId)
      .filter((id): id is string => Boolean(id));
    const reconciledBankItemIds = [
      ...incomingMatches.map((match: { bankStatementItemId: string }) => match.bankStatementItemId),
      ...depositBankItemIds,
    ];
    const depositAltegioIds = depositMatches.map((match) => match.altegioTransactionId);

    console.log("[payment-reconciliation/incoming][GET] Готово", {
      ms: Date.now() - startedAt,
      altegioPayers: preview.altegio.byPayer.length,
      bankDays: preview.bank.byDay.length,
      matches: incomingMatches.length,
    });

    return NextResponse.json({
      ok: true,
      ...preview,
      reconciled: {
        bankItemIds: reconciledBankItemIds,
        matches: incomingMatches,
        depositMatches,
        depositAltegioIds,
        depositBankItemIds,
      },
    });
  } catch (error) {
    console.error("[payment-reconciliation/incoming] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити вхідні платежі" },
      { status: 500 },
    );
  }
}

/** Ручне зведення (кнопка «Звести»): лише точні пари з live-оцінки (Δ=0 / іменовані / еквайринг). */
export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const startedAt = Date.now();
    // Той самий швидкий preview, що й GET: /transactions 21 день + БД, без documents 404-шторму.
    const preview = await buildIncomingReconciliationPreview({
      liveLookbackDays: 21,
      skipDocumentEnrichment: true,
    });
    console.log("[payment-reconciliation/incoming][POST] Preview готовий", {
      ms: Date.now() - startedAt,
      altegioPayers: preview.altegio.byPayer.length,
      bankDays: preview.bank.byDay.length,
      liveRows: preview.altegio.stats?.liveRows ?? null,
      dbRows: preview.altegio.stats?.dbRows ?? null,
    });

    const incomingSummary = await syncExactOpenPairsFromPreview(preview, {
      matchedBy: "manual_incoming_reconcile",
    });
    console.log("[payment-reconciliation/incoming][POST] Точні пари", {
      ms: Date.now() - startedAt,
      exactPairsFound: incomingSummary.exactPairsFound,
      openDays: incomingSummary.days,
      matchedBankItems: incomingSummary.matchedBankItems,
      hasDepositPairs: incomingSummary.hasDepositPairs,
      errors: incomingSummary.errors,
    });

    // Завдатки — лише якщо live-оцінка вже знайшла точні deposit-пари.
    const depositSummary = incomingSummary.hasDepositPairs
      ? await syncDepositIncomingMatches({
          preview,
          matchedBy: "manual_deposit_reconcile",
        })
      : {
          scanned: 0,
          upserted: 0,
          withBank: 0,
          withoutBank: 0,
          withAppointment: 0,
          paymentDayFallback: 0,
          skippedAlreadyMatchedBank: 0,
          skippedCashAccounts: 0,
          purgedCashAutoMatches: 0,
          errors: [] as string[],
        };

    console.log("[payment-reconciliation/incoming][POST] Готово (точні пари)", {
      ms: Date.now() - startedAt,
      exactPairsFound: incomingSummary.exactPairsFound,
      matchedBankItems: incomingSummary.matchedBankItems,
      days: incomingSummary.days,
      hasDepositPairs: incomingSummary.hasDepositPairs,
      depositUpserted: depositSummary.upserted,
    });

    return NextResponse.json({
      ok: true,
      message: "Зведено лише точні пари з live-оцінки",
      depositSummary,
      incomingSummary,
    });
  } catch (error) {
    console.error("[payment-reconciliation/incoming][POST] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося виконати зведення вхідних" },
      { status: 500 },
    );
  }
}
