import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { buildIncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const preview = await buildIncomingReconciliationPreview();
    const incomingMatches = await (prisma as any).bankAltegioIncomingMatch.findMany({
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
    });

    const reconciledBankItemIds = incomingMatches.map(
      (match: { bankStatementItemId: string }) => match.bankStatementItemId,
    );

    return NextResponse.json({
      ok: true,
      ...preview,
      reconciled: {
        bankItemIds: reconciledBankItemIds,
        matches: incomingMatches,
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
