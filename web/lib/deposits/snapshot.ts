// Нічний знімок залишків завдатків Altegio: контрольне значення для реєстру Kresco.
// Реєстр не змінює; новий рахунок отримує залишок Altegio як стартовий баланс.

import { fetchChainClientDeposits } from "@/lib/altegio/client-deposits";
import { prisma } from "@/lib/prisma";

const EPS = 0.01;

/** Запитів до БД: 2 читання, createMany, updateMany і один update на кожен змінений рахунок. */
export async function captureClientDepositSnapshot() {
  const fetched = await fetchChainClientDeposits({
    balanceFrom: 0.01,
    limitPerPage: 100,
    maxPages: 80,
    maxClientsToScan: 5000,
  });
  const deposits = fetched.deposits.filter((d) => d.depositId > 0 && d.balance > 0);
  // Порожня відповідь — збій Altegio, а не нульові залишки: контрольні значення не чіпаємо.
  if (deposits.length === 0) {
    console.warn("[deposits/snapshot] ⚠️ Altegio не віддав залишків, знімок пропущено");
    return { fetched: 0, created: 0, updated: 0, zeroed: 0, skipped: true };
  }

  const now = new Date();
  const accounts = await prisma.clientDepositAccount.findMany({
    where: { altegioDepositId: { not: null } },
    select: { id: true, altegioDepositId: true, altegioBalance: true },
  });
  const byDepositId = new Map(accounts.map((a) => [a.altegioDepositId, a]));
  const seen = new Set(deposits.map((d) => d.depositId));

  const newOnes = deposits.filter((d) => !byDepositId.has(d.depositId));
  const clientIds = [...new Set(newOnes.map((d) => d.clientId).filter((id): id is number => !!id))];
  const clients = clientIds.length
    ? await prisma.directClient.findMany({
        where: { altegioClientId: { in: clientIds } },
        select: { id: true, altegioClientId: true },
      })
    : [];
  const directByAltegio = new Map(clients.map((c) => [c.altegioClientId, c.id]));
  if (newOnes.length > 0) {
    await prisma.clientDepositAccount.createMany({
      data: newOnes.map((d) => ({
        altegioDepositId: d.depositId,
        altegioClientId: d.clientId,
        directClientId: d.clientId ? directByAltegio.get(d.clientId) ?? null : null,
        title: d.depositTypeTitle || "Особистий рахунок",
        balance: d.balance,
        altegioBalance: d.balance,
        altegioBalanceAt: now,
        blocked: d.blocked,
        source: "altegio_import",
        syncStatus: "synced",
      })),
      skipDuplicates: true,
    });
  }

  let updated = 0;
  for (const deposit of deposits) {
    const account = byDepositId.get(deposit.depositId);
    if (!account || Math.abs((account.altegioBalance ?? -1) - deposit.balance) < EPS) continue;
    await prisma.clientDepositAccount.update({
      where: { id: account.id },
      data: { altegioBalance: deposit.balance, altegioBalanceAt: now },
    });
    updated += 1;
  }

  // Рахунка нема серед ненульових: в Altegio залишок 0.
  const emptied = accounts.filter(
    (a) => a.altegioDepositId != null && !seen.has(a.altegioDepositId) && (a.altegioBalance ?? 0) > 0,
  );
  if (emptied.length > 0) {
    await prisma.clientDepositAccount.updateMany({
      where: { id: { in: emptied.map((a) => a.id) } },
      data: { altegioBalance: 0, altegioBalanceAt: now },
    });
  }

  const total = Math.round(deposits.reduce((sum, d) => sum + d.balance, 0) * 100) / 100;
  console.log("[deposits/snapshot] ✅ Знімок залишків", { count: deposits.length, total, created: newOnes.length, updated });
  return { fetched: deposits.length, total, created: newOnes.length, updated, zeroed: emptied.length, skipped: false };
}
