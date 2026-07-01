import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { buildIncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import {
  loadDepositIncomingMatches,
  syncDepositIncomingMatches,
} from "@/lib/bank/deposit-incoming-reconcile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const preview = await buildIncomingReconciliationPreview();
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
