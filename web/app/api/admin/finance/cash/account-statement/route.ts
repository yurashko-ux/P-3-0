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
const DAY_MS = 24 * 60 * 60 * 1000;
/** Різниця менша за 1 грн — зведено повністю */
const FULL_TOLERANCE_UAH = 1;

function kopToUah(kop: bigint): number {
  return Number(kop) / 100;
}

function kyivDayOf(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

type LinkedDocument = {
  id: string;
  /** kresco — документ Креско; altegio — лише операція Altegio (перехідний період); fee — комісія еквайрингу */
  kind: "kresco" | "altegio" | "fee";
  title: string;
  amount: number;
  kyivDay: string;
};

/**
 * Рухи безготівкового рахунку для розділу Каса: операції банку, прив'язані до них документи,
 * стан зведення (повністю / частково / ні) і документи на цьому рахунку без банківського платежу.
 * Запити: 2 до банку + 1 до документів Креско.
 */
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
    if (accounts.length === 0) return NextResponse.json({ ok: true, rows: [], unlinkedDocuments: [] });

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
            financeDocument: { select: { id: true, purposeTitle: true, amountUah: true, kyivDay: true } },
            altegioFinanceTransaction: {
              select: {
                altegioId: true,
                categoryTitle: true,
                paymentPurpose: true,
                expenseId: true,
                amountKopiykas: true,
                kyivDay: true,
              },
            },
            pendingPayments: { take: 1, orderBy: { createdAt: "desc" }, select: { purposeTitle: true } },
          },
        },
        altegioIncomingMatch: { select: { status: true, matchType: true } },
        altegioDepositMatch: { select: { status: true } },
        // Комісія еквайрингу: документ на утриманий % із зарахування терміналу
        automaticAltegioExpense: { select: { id: true, kind: true, status: true, amountKopiykas: true } },
      },
    });

    const rows = items.map((item) => {
      const bankTitle = item.comment?.trim() || item.description || "";
      const bankAmount = kopToUah(item.amount);
      const documents: LinkedDocument[] = [];
      let article: string | null = null;
      let reconciledInBank = false;

      const match = item.altegioPaymentMatch;
      if (isReconciledBankPaymentMatch(match)) {
        reconciledInBank = true;
        article = resolveBankPaymentExpenseArticle(match);
        if (match?.financeDocument) {
          documents.push({
            id: match.financeDocument.id,
            kind: "kresco",
            title: match.financeDocument.purposeTitle || article || "Документ",
            amount: -Math.abs(match.financeDocument.amountUah),
            kyivDay: match.financeDocument.kyivDay,
          });
        } else if (match?.altegioFinanceTransaction) {
          // Документ Креско ще не створено — показуємо операцію Altegio, з якою зведено
          documents.push({
            id: `altegio-${match.altegioFinanceTransaction.altegioId}`,
            kind: "altegio",
            title: article || "Операція Altegio",
            amount: -Math.abs(kopToUah(match.altegioFinanceTransaction.amountKopiykas)),
            kyivDay: match.altegioFinanceTransaction.kyivDay,
          });
        }
      } else if (isIncomingReconcileMarkByBankTime(item.time)) {
        if (item.altegioDepositMatch && isLinkedIncomingMatchStatus(item.altegioDepositMatch.status)) {
          reconciledInBank = true;
          article = resolveIncomingBankExpenseArticle({ isDepositMatch: true });
        } else if (item.altegioIncomingMatch && isLinkedIncomingMatchStatus(item.altegioIncomingMatch.status)) {
          reconciledInBank = true;
          article = resolveIncomingBankExpenseArticle({ incomingMatchType: item.altegioIncomingMatch.matchType });
        }
      }

      // Термінал зараховує гроші наступного дня за мінусом комісії — документ комісії датуємо днем оплат
      const fee = item.automaticAltegioExpense;
      if (fee?.kind === "acquiring_commission" && ["created", "pending"].includes(fee.status) && fee.amountKopiykas > BigInt(0)) {
        documents.push({
          id: `fee-${fee.id}`,
          kind: "fee",
          title: "Комісія за еквайринг",
          amount: -kopToUah(fee.amountKopiykas),
          kyivDay: kyivDayOf(new Date(item.time.getTime() - DAY_MS)),
        });
      }

      // Стан зведення. Вихідний — за сумою документів; вхідний поки за зведенням Банку
      // (оплати візитів із журналу додамо наступним кроком).
      let status: "full" | "partial" | "none" = reconciledInBank ? "full" : "none";
      let missing = 0;
      if (bankAmount < 0) {
        const linkedSum = documents.reduce((sum, doc) => sum + Math.abs(doc.amount), 0);
        missing = Math.round((Math.abs(bankAmount) - linkedSum) * 100) / 100;
        if (documents.length === 0) status = "none";
        else status = Math.abs(missing) < FULL_TOLERANCE_UAH ? "full" : "partial";
      }

      return {
        id: item.id,
        time: item.time.toISOString(),
        amount: bankAmount,
        balance: item.balance == null ? null : kopToUah(item.balance),
        counterName: item.counterName || "",
        // Стаття з розділу Банк; якщо її немає — опис із банку
        title: article || bankTitle,
        bankTitle,
        status,
        missing: status === "partial" ? missing : 0,
        documents,
      };
    });

    // Документи Креско на цьому рахунку без банківського платежу (ручні Розхід / Прихід / Переміщення)
    const oldest = items.length > 0 ? items[items.length - 1].time : new Date();
    const unlinked = await prisma.financeDocument.findMany({
      where: {
        source: "kresco",
        status: { not: "void" },
        bankPaymentMatch: null,
        occurredAt: { gte: oldest },
        OR: [{ accountId: Number(altegioAccountId) }, { counterAccountId: Number(altegioAccountId) }],
      },
      select: {
        id: true,
        type: true,
        amountUah: true,
        kyivDay: true,
        occurredAt: true,
        purposeTitle: true,
        title: true,
        accountId: true,
        comment: true,
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    const unlinkedDocuments = unlinked.map((doc) => {
      const outgoing = doc.type === "expense" || (doc.type === "transfer" && doc.accountId === Number(altegioAccountId));
      return {
        id: doc.id,
        time: doc.occurredAt.toISOString(),
        kyivDay: doc.kyivDay,
        amount: outgoing ? -Math.abs(doc.amountUah) : Math.abs(doc.amountUah),
        title: doc.purposeTitle || doc.title || "Документ",
        comment: doc.comment || "",
      };
    });

    return NextResponse.json({ ok: true, rows, unlinkedDocuments });
  } catch (error) {
    console.error("[api/admin/finance/cash/account-statement] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити рухи рахунку" },
      { status: 500 },
    );
  }
}
