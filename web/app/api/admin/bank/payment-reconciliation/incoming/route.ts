import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { buildIncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import {
  loadDepositIncomingMatches,
  syncDepositIncomingMatches,
} from "@/lib/bank/deposit-incoming-reconcile";
import { syncIncomingPaymentsForPreview } from "@/lib/bank/incoming-payment-reconcile";
import { repairIncomingAcquiringMatchTypes } from "@/lib/bank/incoming-match-cleanup";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Live Altegio + зведення відкритих днів; 120s часто мало після накопичення історії. */
export const maxDuration = 300;

/** Швидке читання preview + збережені матчі (без автозведення та Altegio deposits). */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const preview = await buildIncomingReconciliationPreview();

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

/** Ручне зведення (кнопка «Звести»): sync відкритих днів (+ легкій repair). */
export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const startedAt = Date.now();
    const preview = await buildIncomingReconciliationPreview();
    console.log("[payment-reconciliation/incoming][POST] Preview готовий", {
      ms: Date.now() - startedAt,
      altegioPayers: preview.altegio.byPayer.length,
      bankDays: preview.bank.byDay.length,
    });

    // Повний purge по всіх матчах — занадто довгий для кнопки «Звести» (таймаут 120s).
    // Залишаємо швидкий repair типів еквайрингу; неповні матчі чистить окремий інструмент/cron.
    const repair = await repairIncomingAcquiringMatchTypes(preview);
    const incomingSummary = await syncIncomingPaymentsForPreview(preview, {
      matchedBy: "manual_incoming_reconcile",
      onlyUnmatchedBankDays: true,
    });
    const depositSummary = await syncDepositIncomingMatches({
      preview,
      matchedBy: "manual_deposit_reconcile",
    });

    console.log("[payment-reconciliation/incoming][POST] Готово", {
      ms: Date.now() - startedAt,
      repaired: repair.repaired,
      matchedBankItems: incomingSummary.matchedBankItems,
      days: incomingSummary.days,
      depositUpserted: depositSummary.upserted,
    });

    return NextResponse.json({
      ok: true,
      message: "Зведення вхідних виконано",
      depositSummary,
      incomingSummary,
      repair,
    });
  } catch (error) {
    console.error("[payment-reconciliation/incoming][POST] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося виконати зведення вхідних" },
      { status: 500 },
    );
  }
}
