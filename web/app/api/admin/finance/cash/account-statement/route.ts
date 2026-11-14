import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";
import { isReconciledBankPaymentMatch, resolveBankPaymentExpenseArticle } from "@/lib/bank/altegio-payment-reconcile";
import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { getPayerNameFromRaw, NO_PAYER_LABEL } from "@/lib/bank/incoming-altegio-aggregate";
import {
  isIncomingReconcileMarkByBankTime,
  isLinkedIncomingMatchStatus,
  resolveIncomingBankExpenseArticle,
} from "@/lib/bank/reconciliation-number";

export const dynamic = "force-dynamic";
// Без кешу fetch: запити Prisma (Accelerate, HTTP) з тими самими параметрами інакше віддавали застарілі дані
export const revalidate = 0;
export const fetchCache = "force-no-store";

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
  /** Оплата клієнта: ім'я і запис — щоб підставити їх у банківський рядок з тією самою сумою */
  clientName?: string | null;
  recordId?: number | null;
};

/**
 * Рухи безготівкового рахунку для розділу Каса: операції банку, прив'язані до них документи,
 * стан зведення (повністю / частково / ні) і документи на цьому рахунку без банківського платежу.
 * Запити: 2 до банку + 1 до документів Креско (+2 на оплати дня для вхідних, +1 на записи журналу).
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
        /** Клієнт і запис оплати, з якою збігся іменований платіж (заповнюється нижче для вхідних) */
        clientName: null as string | null,
        recordId: null as number | null,
        appointmentId: null as string | null,
        status,
        missing: status === "partial" ? missing : 0,
        documents,
        /** День оплат, з яким зведено вхідний (еквайринг — попередній день) */
        incomingDay:
          !item.altegioDepositMatch && item.altegioIncomingMatch && isLinkedIncomingMatchStatus(item.altegioIncomingMatch.status)
            ? item.altegioIncomingMatch.kyivDay
            : null,
        groupNote: "",
        /** Сума оплат клієнта, з якими збігся цей платіж, — лише довідково під приміткою (у суму дня не входить) */
        groupNoteAmount: null as number | null,
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
            checkout: {
              select: { kyivDay: true, appointment: { select: { clientName: true, altegioRecordId: true } } },
            },
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
          select: {
            altegioId: true,
            amountKopiykas: true,
            kyivDay: true,
            counterpartyName: true,
            paymentPurpose: true,
            rawData: true,
          },
        }),
      ]);
      // Завдатки (поповнення рахунку клієнта) — теж гроші на цьому рахунку: розділ Платежі зводить їх з банком
      // Завдаток, уже зведений окремою парою (завдаток ↔ банк), сюди не додаємо — інакше рахувався б двічі
      const pairedDepositIds = new Set(
        (
          await prisma.bankAltegioDepositMatch.findMany({
            where: { altegioTransactionId: { in: altegioPayments.map((payment) => payment.altegioId) }, bankStatementItemId: { not: null } },
            select: { altegioTransactionId: true },
          })
        ).map((row) => row.altegioTransactionId),
      );
      const depositsByDay = (day: string): LinkedDocument[] =>
        altegioPayments
          .filter(
            (payment) =>
              payment.kyivDay === day &&
              isDepositTopUpPaymentPurpose(payment.paymentPurpose || "") &&
              !pairedDepositIds.has(payment.altegioId),
          )
          .map((payment) => {
            const payer = getPayerNameFromRaw(payment.rawData, payment.counterpartyName?.trim() || null);
            const clientName = payer && payer !== NO_PAYER_LABEL ? payer : null;
            return {
              id: `deposit-${payment.altegioId}`,
              kind: "deposit" as const,
              title: `Завдаток: ${clientName || "без платника"}`,
              amount: kopToUah(payment.amountKopiykas),
              kyivDay: day,
              clientName,
              recordId: null,
            };
          });
      const paymentsByDay = (day: string): LinkedDocument[] => [...visitPaymentsByDay(day), ...depositsByDay(day)];
      const visitPaymentsByDay = (day: string): LinkedDocument[] => {
        const journal = journalPayments.filter((payment) => payment.checkout.kyivDay === day);
        if (journal.length > 0) {
          return journal.map((payment) => ({
            id: `visit-${payment.id}`,
            kind: "visit" as const,
            title: payment.checkout.appointment?.clientName?.trim() || "Оплата візиту",
            amount: payment.amount,
            kyivDay: day,
            clientName: payment.checkout.appointment?.clientName?.trim() || null,
            recordId: payment.checkout.appointment?.altegioRecordId ?? null,
          }));
        }
        return altegioPayments
          .filter(
            (payment) =>
              payment.kyivDay === day &&
              !isDepositTopUpPaymentPurpose(payment.paymentPurpose || "") &&
              !/переміщ/i.test(payment.paymentPurpose || ""),
          )
          .map((payment) => {
            // Платник — так само, як у розділі Платежі (ім'я з різних полів операції Altegio)
            const payer = getPayerNameFromRaw(payment.rawData, payment.counterpartyName?.trim() || null);
            const clientName = payer && payer !== NO_PAYER_LABEL ? payer : null;
            // Запис — з тих самих полів, що в розділі Платежі
            const raw = (payment.rawData ?? {}) as Record<string, unknown>;
            const nested = (key: string) => (raw[key] && typeof raw[key] === "object" ? (raw[key] as { id?: unknown }).id : null);
            const recordId =
              Number(raw.record_id ?? raw.recordId ?? nested("record") ?? raw.appointment_id ?? nested("appointment")) || null;
            return {
              id: `payment-${payment.altegioId}`,
              kind: "payment" as const,
              title: clientName || payment.counterpartyName?.trim() || payment.paymentPurpose?.trim() || "Оплата",
              amount: kopToUah(payment.amountKopiykas),
              kyivDay: day,
              clientName,
              recordId: recordId && recordId > 0 ? recordId : null,
            };
          });
      };
      for (const day of incomingDays) {
        const groupRows = rows.filter((row) => row.incomingDay === day);
        // Оплати одного клієнта за день — один документ (у Altegio оплату часто розбито на кілька операцій)
        const merged = new Map<string, LinkedDocument>();
        const unnamed: LinkedDocument[] = [];
        for (const doc of paymentsByDay(day)) {
          if (!doc.clientName) {
            unnamed.push(doc);
            continue;
          }
          const current = merged.get(doc.clientName);
          if (!current) merged.set(doc.clientName, { ...doc });
          else {
            current.amount = Math.round((current.amount + doc.amount) * 100) / 100;
            current.recordId = current.recordId ?? doc.recordId ?? null;
          }
        }
        const visits = [...merged.values(), ...unnamed].sort((a, b) => b.amount - a.amount);
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
        // Платіж, що точно дорівнює оплатам одного клієнта за день (іменований переказ) — клієнт і запис цих оплат.
        // Оплату клієнта в Altegio часто розбито на кілька операцій, тож порівнюємо із сумою по клієнту, як у розділі Платежі.
        const byClient = new Map<string, { clientName: string; recordIds: Set<number>; amount: number; onlyDeposits: boolean }>();
        for (const doc of visits) {
          if (!doc.clientName) continue;
          const group = byClient.get(doc.clientName) ?? { clientName: doc.clientName, recordIds: new Set<number>(), amount: 0, onlyDeposits: true };
          group.amount += doc.amount;
          if (doc.kind !== "deposit") group.onlyDeposits = false;
          if (doc.recordId) group.recordIds.add(doc.recordId);
          byClient.set(doc.clientName, group);
        }
        const usedClients = new Set<string>();
        const matchedAmount = new Map<string, number>();
        for (const row of groupRows) {
          const client = [...byClient.values()].find(
            (group) => !usedClients.has(group.clientName) && Math.abs(group.amount - row.amount) < 0.01,
          );
          if (!client) continue;
          usedClients.add(client.clientName);
          matchedAmount.set(row.id, Math.round(client.amount * 100) / 100);
          row.clientName = client.clientName;
          // Як у розділі Платежі: перший запис серед оплат клієнта
          row.recordId = [...client.recordIds][0] ?? null;
          // Платіж збігся із завдатком клієнта — у касі це завдаток, а не оплата візиту
          if (client.onlyDeposits) row.title = "Завдаток";
        }
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
            row.groupNoteAmount = matchedAmount.get(row.id) ?? null;
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

    // Чеки журналу на цьому рахунку, чий день оплат не зведено з жодним зарахуванням банку — червоне коло
    const linkedDays = new Set(rows.map((row) => row.incomingDay).filter((day): day is string => Boolean(day)));
    const oldestDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(oldest);
    const checkPayments = await prisma.salonCheckoutPayment.findMany({
      where: {
        accountId: Number(altegioAccountId),
        paymentKind: "account",
        checkout: { kyivDay: { gte: oldestDay }, status: { not: "void" } },
      },
      select: {
        amount: true,
        checkout: {
          select: { id: true, altegioVisitId: true, kyivDay: true, createdAt: true, appointment: { select: { clientName: true } } },
        },
      },
      take: 500,
    });
    const checksById = new Map<string, (typeof unlinkedDocuments)[number] & { check: true }>();
    for (const payment of checkPayments) {
      const checkout = payment.checkout;
      if (linkedDays.has(checkout.kyivDay)) continue;
      // Візит з кількома майстрами — кілька чеків у Altegio, але один рядок
      const key = checkout.altegioVisitId ? `v${checkout.altegioVisitId}` : checkout.id;
      const current = checksById.get(key);
      if (current) {
        current.amount = Math.round((current.amount + payment.amount) * 100) / 100;
        continue;
      }
      checksById.set(key, {
        id: `check-${key}`,
        time: checkout.createdAt.toISOString(),
        kyivDay: checkout.kyivDay,
        amount: payment.amount,
        title: checkout.appointment?.clientName?.trim() || "Чек",
        comment: "",
        check: true,
      });
    }
    const unmatchedChecks = [...checksById.values()];
    if (unmatchedChecks.length > 0) {
      console.log(`[api/admin/finance/cash/account-statement] Незведені чеки на рахунку ${altegioAccountId}: ${unmatchedChecks.length}`);
    }

    // Запис клієнта в журналі Креско — для посилання з колонки «Запис» (один запит)
    const recordIds = [...new Set(rows.map((row) => row.recordId).filter((id): id is number => Boolean(id)))];
    if (recordIds.length > 0) {
      const appointments = await prisma.salonAppointment.findMany({
        where: { altegioRecordId: { in: recordIds } },
        select: { id: true, altegioRecordId: true },
      });
      const byRecord = new Map(appointments.map((a) => [a.altegioRecordId, a.id]));
      for (const row of rows) {
        if (row.recordId) row.appointmentId = byRecord.get(row.recordId) ?? null;
      }
    }
    return NextResponse.json({ ok: true, rows, unlinkedDocuments: [...unlinkedDocuments, ...unmatchedChecks] });
  } catch (error) {
    console.error("[api/admin/finance/cash/account-statement] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити рухи рахунку" },
      { status: 500 },
    );
  }
}
