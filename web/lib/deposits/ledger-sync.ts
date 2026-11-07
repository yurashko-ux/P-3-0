// Реєстр завдатків від першого знімка Altegio: старт = знімок, далі лише нові поповнення й списання.
// Старі операції не переносимо: вони не пояснюють усіх залишків.

import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { isPaidFromDeposit } from "@/lib/finance/report-kresco";
import { prisma } from "@/lib/prisma";

const ANCHOR_COMMENT = "Старт реєстру: знімок Altegio";
const EPS = 1; // грн

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function kyivDayOf(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" });
}

type Movement = {
  kind: "topup" | "spend";
  altegioClientId: number;
  amount: number;
  kyivDay: string;
  altegioPaymentTxId: number | null;
  altegioDocumentId: number | null;
  salonAppointmentId: string | null;
  salonCheckoutId: string | null;
};

/**
 * Сухий прогін за замовчуванням. Читання: 5 запитів.
 * Застосування: по одному create/update на рух і рахунок; запускається лише вручну.
 */
export async function syncDepositLedger(options: { apply?: boolean } = {}) {
  const accounts = await prisma.clientDepositAccount.findMany({
    where: { altegioDepositId: { not: null }, isActive: true },
    select: { id: true, altegioClientId: true, balance: true, altegioBalance: true, altegioBalanceAt: true },
  });
  const stamps = accounts.flatMap((a) => (a.altegioBalanceAt ? [a.altegioBalanceAt.getTime()] : []));
  if (stamps.length === 0) return { ready: false, reason: "Знімка Altegio ще немає" };

  const anchors = await prisma.clientDepositLedgerEntry.findMany({
    where: { comment: ANCHOR_COMMENT },
    select: { accountId: true, kyivDay: true },
  });
  const anchoredAt = new Map(anchors.map((a) => [a.accountId, a.kyivDay]));
  // Перша точка старту фіксує день для всіх; знімок оновлює лише змінені рахунки.
  const startDay =
    anchors.map((a) => a.kyivDay).sort()[0] ?? kyivDayOf(new Date(Math.max(...stamps)));

  const [incomeRows, checkouts, booked] = await Promise.all([
    prisma.altegioFinanceTransaction.findMany({
      where: {
        kyivDay: { gte: startDay },
        deletedInAltegio: false,
        amountKopiykas: { gt: 0 },
        direction: { not: "transfer" },
      },
      select: { altegioId: true, documentId: true, kyivDay: true, amountKopiykas: true, paymentPurpose: true, rawData: true },
    }),
    prisma.salonCheckout.findMany({
      where: { kyivDay: { gte: startDay }, status: { not: "void" }, appointment: { status: { not: "deleted" } } },
      select: {
        id: true,
        appointmentId: true,
        kyivDay: true,
        totalServices: true,
        totalGoods: true,
        source: true,
        payments: { select: { paymentKind: true } },
        appointment: { select: { altegioRecordId: true, altegioVisitId: true, altegioClientId: true } },
      },
    }),
    prisma.clientDepositLedgerEntry.findMany({
      where: { kyivDay: { gte: startDay }, kind: { in: ["topup", "spend"] } },
      select: { accountId: true, amount: true, altegioPaymentTxId: true, salonCheckoutId: true },
    }),
  ]);

  const bookedTx = new Set(booked.map((b) => b.altegioPaymentTxId).filter((id) => id != null));
  const bookedCheckouts = new Set(booked.map((b) => b.salonCheckoutId).filter((id) => id != null));

  const movements: Movement[] = [];
  const paidRecordIds = new Set<number>();
  for (const row of incomeRows) {
    const raw = row.rawData as { record_id?: unknown; client?: { id?: unknown } } | null;
    if (!isDepositTopUpPaymentPurpose(row.paymentPurpose || "")) {
      const recordId = Number(raw?.record_id) || 0;
      if (recordId > 0) paidRecordIds.add(recordId);
      continue;
    }
    if (bookedTx.has(row.altegioId)) continue;
    movements.push({
      kind: "topup",
      altegioClientId: Number(raw?.client?.id) || 0,
      amount: money(Number(row.amountKopiykas) / 100),
      kyivDay: row.kyivDay,
      altegioPaymentTxId: row.altegioId,
      altegioDocumentId: row.documentId,
      salonAppointmentId: null,
      salonCheckoutId: null,
    });
  }

  const paidVisitIds = new Set(
    checkouts
      .filter((c) => c.appointment.altegioRecordId != null && paidRecordIds.has(c.appointment.altegioRecordId))
      .map((c) => c.appointment.altegioVisitId)
      .filter((id): id is number => id != null),
  );
  for (const c of checkouts) {
    const total = money((Number(c.totalServices) || 0) + (Number(c.totalGoods) || 0));
    if (!(total > 0) || bookedCheckouts.has(c.id)) continue;
    if (!isPaidFromDeposit(c, paidRecordIds, paidVisitIds)) continue;
    movements.push({
      kind: "spend",
      altegioClientId: Number(c.appointment.altegioClientId) || 0,
      amount: -total,
      kyivDay: c.kyivDay,
      altegioPaymentTxId: null,
      altegioDocumentId: null,
      salonAppointmentId: c.appointmentId,
      salonCheckoutId: c.id,
    });
  }
  movements.sort((a, b) => a.kyivDay.localeCompare(b.kyivDay));

  // Рахунок без знімка і без залишку: в Altegio на ньому 0.
  const balances = new Map(
    accounts.map((a) => [a.id, anchoredAt.has(a.id) ? a.balance : a.altegioBalance ?? 0]),
  );
  const accountByClient = new Map(
    accounts.filter((a) => a.altegioClientId != null).map((a) => [a.altegioClientId as number, a.id]),
  );
  const unassigned: Movement[] = [];
  const plan: Array<Movement & { accountId: string; balanceAfter: number }> = [];
  for (const m of movements) {
    const accountId = accountByClient.get(m.altegioClientId);
    // Нового рахунку не вигадуємо: нічний знімок принесе його вже із залишком.
    if (!accountId) {
      unassigned.push(m);
      continue;
    }
    const balanceAfter = money((balances.get(accountId) ?? 0) + m.amount);
    balances.set(accountId, balanceAfter);
    plan.push({ ...m, accountId, balanceAfter });
  }

  const diffs = accounts
    .map((a) => ({
      accountId: a.id,
      altegioClientId: a.altegioClientId,
      ledger: balances.get(a.id) ?? 0,
      altegio: a.altegioBalance ?? 0,
    }))
    .filter((d) => Math.abs(d.ledger - d.altegio) > EPS);

  let applied = 0;
  if (options.apply) {
    const toAnchor = accounts.filter((a) => !anchoredAt.has(a.id));
    await prisma.clientDepositLedgerEntry.createMany({
      data: toAnchor.map((a) => ({
        accountId: a.id,
        kind: "import_snapshot",
        amount: a.altegioBalance ?? 0,
        balanceAfter: a.altegioBalance ?? 0,
        kyivDay: startDay,
        comment: ANCHOR_COMMENT,
        source: "altegio",
        syncStatus: "synced",
      })),
    });
    for (const { accountId, altegioClientId: _client, ...entry } of plan) {
      await prisma.clientDepositLedgerEntry.create({
        data: { ...entry, accountId, source: "altegio", syncStatus: "synced", comment: null },
      });
      applied += 1;
    }
    for (const a of accounts) {
      const balance = balances.get(a.id) ?? 0;
      if (Math.abs(balance - a.balance) < 0.01) continue;
      await prisma.clientDepositAccount.update({ where: { id: a.id }, data: { balance } });
    }
  }

  const sum = (kind: Movement["kind"]) =>
    money(plan.filter((m) => m.kind === kind).reduce((total, m) => total + m.amount, 0));
  return {
    ready: true,
    startDay,
    accounts: accounts.length,
    notAnchored: accounts.filter((a) => !anchoredAt.has(a.id)).length,
    topups: { count: plan.filter((m) => m.kind === "topup").length, sum: sum("topup") },
    spends: { count: plan.filter((m) => m.kind === "spend").length, sum: sum("spend") },
    unassigned,
    totalLedger: money([...balances.values()].reduce((total, b) => total + b, 0)),
    totalAltegio: money(accounts.reduce((total, a) => total + (a.altegioBalance ?? 0), 0)),
    diffCount: diffs.length,
    diffs: diffs.slice(0, 50),
    applied,
  };
}
