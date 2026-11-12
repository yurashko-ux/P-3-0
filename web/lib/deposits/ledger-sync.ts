// Реєстр завдатків від першого знімка Altegio: старт = знімок, далі лише нові поповнення й списання.
// Старі операції не переносимо: вони не пояснюють усіх залишків.
// Кожен рахунок має власну точку старту (час знімка або імпорту): рухи до неї вже є в залишку старту.

import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { isPaidFromDeposit } from "@/lib/finance/report-kresco";
import { prisma } from "@/lib/prisma";
import { DEPOSIT_ANCHOR_COMMENT } from "./store";

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
  /** Коли рух потрапив у систему: операція Altegio або створення чека. */
  at: Date;
  altegioPaymentTxId: number | null;
  altegioDocumentId: number | null;
  salonAppointmentId: string | null;
  salonCheckoutId: string | null;
};

/**
 * Сухий прогін за замовчуванням. Читання: 5 запитів.
 * Застосування: createMany стартів, по одному create на рух, update на змінений рахунок
 * і updateMany для позначок звірки.
 * `applyIfAnchored` — для нічного крону: пише лише після ручного старту (кнопка №109).
 */
export async function syncDepositLedger(options: { apply?: boolean; applyIfAnchored?: boolean } = {}) {
  const accounts = await prisma.clientDepositAccount.findMany({
    where: { altegioDepositId: { not: null }, isActive: true },
    select: {
      id: true,
      altegioClientId: true,
      balance: true,
      altegioBalance: true,
      altegioBalanceAt: true,
      syncStatus: true,
    },
  });
  const stamps = accounts.flatMap((a) => (a.altegioBalanceAt ? [a.altegioBalanceAt.getTime()] : []));
  if (stamps.length === 0) return { ready: false, reason: "Знімка Altegio ще немає" };
  // Знімок оновлює лише змінені рахунки, тож altegioBalance кожного — станом на останній знімок.
  const snapshotAt = new Date(Math.max(...stamps));

  const anchors = await prisma.clientDepositLedgerEntry.findMany({
    where: { comment: DEPOSIT_ANCHOR_COMMENT },
    select: { accountId: true, createdAt: true },
  });
  const anchoredAt = new Map(anchors.map((a) => [a.accountId, a.createdAt]));
  const apply = Boolean(options.apply || (options.applyIfAnchored && anchors.length > 0));
  // Рахунок без старту стартує від останнього знімка.
  const anchorOf = (accountId: string) => anchoredAt.get(accountId) ?? snapshotAt;
  const startDay = [...anchors.map((a) => kyivDayOf(a.createdAt)), kyivDayOf(snapshotAt)].sort()[0];

  const [incomeRows, checkouts, booked] = await Promise.all([
    prisma.altegioFinanceTransaction.findMany({
      where: {
        kyivDay: { gte: startDay },
        deletedInAltegio: false,
        amountKopiykas: { gt: 0 },
        direction: { not: "transfer" },
      },
      select: {
        altegioId: true,
        documentId: true,
        kyivDay: true,
        operationDate: true,
        amountKopiykas: true,
        paymentPurpose: true,
        rawData: true,
      },
    }),
    prisma.salonCheckout.findMany({
      where: { kyivDay: { gte: startDay }, status: { not: "void" }, appointment: { status: { not: "deleted" } } },
      select: {
        id: true,
        appointmentId: true,
        kyivDay: true,
        createdAt: true,
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
      at: row.operationDate,
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
      at: c.createdAt,
      altegioPaymentTxId: null,
      altegioDocumentId: null,
      salonAppointmentId: c.appointmentId,
      salonCheckoutId: c.id,
    });
  }
  movements.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Рахунок без знімка і без залишку: в Altegio на ньому 0.
  const balances = new Map(
    accounts.map((a) => [a.id, anchoredAt.has(a.id) ? a.balance : a.altegioBalance ?? 0]),
  );
  const accountByClient = new Map(
    accounts.filter((a) => a.altegioClientId != null).map((a) => [a.altegioClientId as number, a.id]),
  );
  const unassigned: Movement[] = [];
  const plan: Array<Movement & { accountId: string; balanceAfter: number }> = [];
  let beforeAnchor = 0;
  for (const m of movements) {
    const accountId = accountByClient.get(m.altegioClientId);
    // Нового рахунку не вигадуємо: нічний знімок принесе його вже із залишком.
    if (!accountId) {
      unassigned.push(m);
      continue;
    }
    // Рух до старту рахунку вже врахований у його стартовому залишку.
    const anchor = anchorOf(accountId);
    if (m.kyivDay < kyivDayOf(anchor) || m.at.getTime() <= anchor.getTime()) {
      beforeAnchor += 1;
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
  if (apply) {
    const toAnchor = accounts.filter((a) => !anchoredAt.has(a.id));
    if (toAnchor.length > 0) {
      await prisma.clientDepositLedgerEntry.createMany({
        data: toAnchor.map((a) => ({
          accountId: a.id,
          kind: "import_snapshot",
          amount: a.altegioBalance ?? 0,
          balanceAfter: a.altegioBalance ?? 0,
          kyivDay: kyivDayOf(snapshotAt),
          comment: DEPOSIT_ANCHOR_COMMENT,
          source: "altegio",
          syncStatus: "synced",
          // Час старту = час знімка: за ним звірка відрізняє рухи, які вже в залишку.
          createdAt: snapshotAt,
        })),
      });
    }
    for (const { accountId, altegioClientId: _client, at: _at, ...entry } of plan) {
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
    // Позначки звірки: розбіжність із Altegio видно в рахунку, поки вона не зникне.
    const diffIds = diffs.map((d) => d.accountId);
    const healed = accounts.filter((a) => a.syncStatus === "drift" && !diffIds.includes(a.id)).map((a) => a.id);
    if (healed.length > 0) {
      await prisma.clientDepositAccount.updateMany({
        where: { id: { in: healed } },
        data: { syncStatus: "synced", syncError: null },
      });
    }
    if (diffIds.length > 0) {
      await prisma.clientDepositAccount.updateMany({
        where: { id: { in: diffIds } },
        data: { syncStatus: "drift", syncError: "Реєстр Kresco ≠ знімок Altegio — див. нічну звірку" },
      });
    }
    console.log(
      `[deposits/ledger-sync] Записано: стартів ${toAnchor.length}, рухів ${applied}, розбіжностей ${diffs.length}`,
    );
  }

  const sum = (kind: Movement["kind"]) =>
    money(plan.filter((m) => m.kind === kind).reduce((total, m) => total + m.amount, 0));
  return {
    ready: true,
    /** true — цей запуск писав у реєстр. */
    wrote: apply,
    startDay,
    snapshotAt: snapshotAt.toISOString(),
    accounts: accounts.length,
    notAnchored: accounts.filter((a) => !anchoredAt.has(a.id)).length,
    topups: { count: plan.filter((m) => m.kind === "topup").length, sum: sum("topup") },
    spends: { count: plan.filter((m) => m.kind === "spend").length, sum: sum("spend") },
    beforeAnchor,
    unassigned,
    totalLedger: money([...balances.values()].reduce((total, b) => total + b, 0)),
    totalAltegio: money(accounts.reduce((total, a) => total + (a.altegioBalance ?? 0), 0)),
    diffCount: diffs.length,
    diffs: diffs.slice(0, 50),
    applied,
  };
}
