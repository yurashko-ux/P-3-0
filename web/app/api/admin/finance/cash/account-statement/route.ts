import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";
import { isReconciledBankPaymentMatch, resolveBankPaymentExpenseArticle } from "@/lib/bank/altegio-payment-reconcile";
import {
  isIncomingReconcileMarkByBankTime,
  isLinkedIncomingMatchStatus,
  resolveIncomingBankExpenseArticle,
} from "@/lib/bank/reconciliation-number";

export const dynamic = "force-dynamic";

const STATEMENT_LIMIT = 300;

function kopToUah(kop: bigint): number {
  return Number(kop) / 100;
}

/** Рухи безготівкового рахунку для розділу Каса: останні операції банку зі зведенням. Два запити до БД. */
export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;

  const altegioAccountId = (req.nextUrl.searchParams.get("accountId") || "").trim();
  if (!/^\d+$/.test(altegioAccountId)) {
    return NextResponse.json({ ok: false, error: "Немає рахунку" }, { status: 400 });
  }

  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { includeInOperationsTable: true, altegioAccountId },
      select: { id: true },
    });
    if (accounts.length === 0) return NextResponse.json({ ok: true, rows: [] });

    const items = await prisma.bankStatementItem.findMany({
      where: { accountId: { in: accounts.map((account) => account.id) }, paymentsHiddenAt: null },
      orderBy: [{ time: "desc" }, { id: "desc" }],
      take: STATEMENT_LIMIT,
      select: {
        id: true,
        time: true,
        amount: true,
        balance: true,
        counterName: true,
        description: true,
        comment: true,
        // Стаття й зведення — так само, як колонка «Стаття» в розділі Банк
        altegioPaymentMatch: {
          select: {
            status: true,
            altegioFinanceTransactionId: true,
            financeDocumentId: true,
            financeDocument: { select: { purposeTitle: true } },
            altegioFinanceTransaction: { select: { categoryTitle: true, paymentPurpose: true, expenseId: true } },
            pendingPayments: { take: 1, orderBy: { createdAt: "desc" }, select: { purposeTitle: true } },
          },
        },
        altegioIncomingMatch: { select: { status: true, matchType: true } },
        altegioDepositMatch: { select: { status: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      rows: items.map((item) => {
        const bankTitle = item.comment?.trim() || item.description || "";
        let article: string | null = null;
        let reconciled = false;
        if (isReconciledBankPaymentMatch(item.altegioPaymentMatch)) {
          reconciled = true;
          article = resolveBankPaymentExpenseArticle(item.altegioPaymentMatch);
        } else if (isIncomingReconcileMarkByBankTime(item.time)) {
          if (item.altegioDepositMatch && isLinkedIncomingMatchStatus(item.altegioDepositMatch.status)) {
            reconciled = true;
            article = resolveIncomingBankExpenseArticle({ isDepositMatch: true });
          } else if (item.altegioIncomingMatch && isLinkedIncomingMatchStatus(item.altegioIncomingMatch.status)) {
            reconciled = true;
            article = resolveIncomingBankExpenseArticle({ incomingMatchType: item.altegioIncomingMatch.matchType });
          }
        }
        return {
          id: item.id,
          time: item.time.toISOString(),
          amount: kopToUah(item.amount),
          balance: item.balance == null ? null : kopToUah(item.balance),
          counterName: item.counterName || "",
          // Стаття з розділу Банк; якщо її немає — опис із банку
          title: article || bankTitle,
          bankTitle,
          reconciled,
        };
      }),
    });
  } catch (error) {
    console.error("[api/admin/finance/cash/account-statement] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити рухи рахунку" },
      { status: 500 },
    );
  }
}
