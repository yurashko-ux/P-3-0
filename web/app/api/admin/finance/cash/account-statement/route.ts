import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";
import { isReconciledBankPaymentMatch, resolveBankPaymentExpenseArticle } from "@/lib/bank/altegio-payment-reconcile";
import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
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
  /** kresco — документ Креско; altegio — лише операція Altegio (перехідний період); fee — комісія еквайрингу;
   * visit — оплата візиту з журналу Креско; payment — оплата клієнта з копії Altegio в базі Креско;
   * deposit — завдаток клієнта */
  kind: "kresco" | "altegio" | "fee" | "visit" | "payment" | "deposit";
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
            financeDocument: {
              select: {
                id: true,
                purposeTitle: true,
                amountUah: true,
                kyivDay: true,
                type: true,
                accountTitle: true,
                counterAccountTitle: true,
              },
            },
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
        altegioIncomingMatch: { select: { status: true, matchType: true, kyivDay: true } },
        altegioDepositMatch: { select: { status: true, payerName: true, amountKopiykas: true, paymentKyivDay: true } },
        // Комісія еквайрингу: документ на утриманий % із зарахування терміналу
        automaticAltegioExpense: { select: { id: true, kind: true, status: true, amountKopiykas: true } },
      },
    });

    const rows = items.map((item) => {
      const bankTitle = item.comment?.trim() || item.description || "";
      const bankAmount = kopToUah(item.amount);
      const documents: LinkedDocument[] = [];
      let article: string | null = null;
      /** Переміщення: з якого рахунку на який (з документа Креско) */
      let transferFrom: string | null = null;
      let transferTo: string | null = null;
      let reconciledInBank = false;

      const match = item.altegioPaymentMatch;
      if (isReconciledBankPaymentMatch(match)) {
        reconciledInBank = true;
        article = resolveBankPaymentExpenseArticle(match);
        if (match?.financeDocument?.type === "transfer") {
          transferFrom = match.financeDocument.accountTitle?.trim() || null;
          transferTo = match.financeDocument.counterAccountTitle?.trim() || null;
        }
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
          documents.push({
            id: `deposit-${item.id}`,
            kind: "deposit",
            title: `Завдаток: ${item.altegioDepositMatch.payerName}`,
            amount: kopToUah(item.altegioDepositMatch.amountKopiykas),
            kyivDay: item.altegioDepositMatch.paymentKyivDay,
          });
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
      if (bankAmount < 0 || documents.some((doc) => doc.kind === "deposit")) {
        const linkedSum = Math.abs(documents.reduce((sum, doc) => sum + (doc.kind === "fee" ? 0 : doc.amount), 0));
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
        transferFrom,
        transferTo,
        status,
        missing: status === "partial" ? missing : 0,
        documents,
        /** День оплат, з яким зведено вхідний (еквайринг — попередній день) */
        incomingDay:
          !item.altegioDepositMatch && item.altegioIncomingMatch && isLinkedIncomingMatchStatus(item.altegioIncomingMatch.status)
            ? item.altegioIncomingMatch.kyivDay
            : null,
        groupNote: "",
      };
    });

    // Вхідні зводяться днем: усі зарахування одного дня оплат разом з оплатами візитів цього дня на рахунку.
    // Документи — оплати візитів із журналу Креско; сума зарахувань + утримана комісія = сума оплат.
    const incomingDays = [...new Set(rows.map((row) => row.incomingDay).filter((day): day is string => Boolean(day)))];
    if (incomingDays.length > 0) {
      // Джерело оплат: журнал Креско, коли в ньому є рахунок (імпорт з 08.11.2026);
      // інакше — фінансові операції Altegio, збережені в Креско (за ними й зводиться зараз)
      const [journalPayments, altegioPayments] = await Promise.all([
        prisma.salonCheckoutPayment.findMany({
          where: {
            accountId: Number(altegioAccountId),
            checkout: { kyivDay: { in: incomingDays }, status: { not: "void" } },
          },
          select: {
            id: true,
            amount: true,
            checkout: { select: { kyivDay: true, appointment: { select: { clientName: true } } } },
          },
        }),
        prisma.altegioFinanceTransaction.findMany({
          where: {
            accountId: altegioAccountId,
            kyivDay: { in: incomingDays },
            deletedInAltegio: false,
            amountKopiykas: { gt: BigInt(0) },
            direction: { not: "transfer" },
          },
          select: { altegioId: true, amountKopiykas: true, kyivDay: true, counterpartyName: true, paymentPurpose: true },
        }),
      ]);
      const paymentsByDay = (day: string): LinkedDocument[] => {
        const journal = journalPayments.filter((payment) => payment.checkout.kyivDay === day);
        if (journal.length > 0) {
          return journal.map((payment) => ({
            id: `visit-${payment.id}`,
            kind: "visit" as const,
            title: payment.checkout.appointment?.clientName?.trim() || "Оплата візиту",
            amount: payment.amount,
            kyivDay: day,
          }));
        }
        return altegioPayments
          .filter(
            (payment) =>
              payment.kyivDay === day &&
              !isDepositTopUpPaymentPurpose(payment.paymentPurpose || "") &&
              !/переміщ/i.test(payment.paymentPurpose || ""),
          )
          .map((payment) => ({
            id: `payment-${payment.altegioId}`,
            kind: "payment" as const,
            title: payment.counterpartyName?.trim() || payment.paymentPurpose?.trim() || "Оплата",
            amount: kopToUah(payment.amountKopiykas),
            kyivDay: day,
          }));
      };
      for (const day of incomingDays) {
        const groupRows = rows.filter((row) => row.incomingDay === day);
        const visits = paymentsByDay(day).sort((a, b) => b.amount - a.amount);
        const bankSum = groupRows.reduce((sum, row) => sum + row.amount, 0);
        const feeSum = groupRows.reduce(
          (sum, row) => sum + row.documents.filter((doc) => doc.kind === "fee").reduce((acc, doc) => acc + Math.abs(doc.amount), 0),
          0,
        );
        const visitsSum = visits.reduce((sum, doc) => sum + doc.amount, 0);
        const missing = Math.round((bankSum + feeSum - visitsSum) * 100) / 100;
        const status: "full" | "partial" | "none" =
          visits.length === 0 ? "none" : Math.abs(missing) < FULL_TOLERANCE_UAH ? "full" : "partial";
        // Оплати показуємо під першим зарахуванням дня, інші рядки посилаються на нього точно:
        // назва + дата й час банку (еквайринг часто зараховано наступного дня)
        const rowRef = (row: (typeof groupRows)[number]) => {
          const at = new Date(row.time);
          const date = at.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit" });
          const time = at.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
          return `«${row.title || "зарахування"}» ${date} о ${time}`;
        };
        groupRows.forEach((row, index) => {
          row.status = status;
          if (index === 0) {
            row.documents = [...visits, ...row.documents];
            row.missing = status === "partial" ? missing : 0;
            if (groupRows.length > 1) {
              row.groupNote = `Оплати ${day.slice(8, 10)}.${day.slice(5, 7)} зведено разом з ${groupRows.slice(1).map(rowRef).join(", ")}`;
            }
          } else {
            row.groupNote = `Зведено разом з ${rowRef(groupRows[0])} — документи оплат ${day.slice(8, 10)}.${day.slice(5, 7)} там`;
          }
        });
      }
    }

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
