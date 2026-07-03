import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { buildIncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import {
  loadDepositIncomingMatches,
  syncDepositIncomingMatches,
} from "@/lib/bank/deposit-incoming-reconcile";
import { syncIncomingPaymentsForPreview } from "@/lib/bank/incoming-payment-reconcile";
import { repairIncomingAcquiringMatchTypes, purgeIncompleteIncomingMatches } from "@/lib/bank/incoming-match-cleanup";
import { buildDepositRealizationForPreview } from "@/lib/bank/deposit-realization";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const preview = await buildIncomingReconciliationPreview();
    await purgeIncompleteIncomingMatches(preview);
    await repairIncomingAcquiringMatchTypes(preview);
    await syncIncomingPaymentsForPreview(preview, { matchedBy: "auto_incoming_reconcile" });
    await syncDepositIncomingMatches({ preview, matchedBy: "auto_deposit_reconcile" });

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

    const reconciledBankItemIdSet = new Set(reconciledBankItemIds);
    const depositRealization = await buildDepositRealizationForPreview({
      preview,
      depositMatches,
      reconciledBankItemIds: reconciledBankItemIdSet,
    });

    return NextResponse.json({
      ok: true,
      ...preview,
      depositRealization,
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

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const preview = await buildIncomingReconciliationPreview();
    await purgeIncompleteIncomingMatches(preview);
    await repairIncomingAcquiringMatchTypes(preview);
    const incomingSummary = await syncIncomingPaymentsForPreview(preview, { matchedBy: "manual_incoming_reconcile" });
    const depositSummary = await syncDepositIncomingMatches({ preview, matchedBy: "manual_deposit_reconcile" });

    return NextResponse.json({
      ok: true,
      message: "Зведення вхідних виконано",
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
