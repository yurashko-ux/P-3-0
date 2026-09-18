// Етап 5: нативний ledger завдатки (dual-write з Altegio).

import { prisma } from "@/lib/prisma";
import { fetchDepositsForClientIds } from "@/lib/altegio/client-deposits";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";

function toMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

const DRIFT_EPS = 1; // грн

export type EnsureDepositAccountParams = {
  altegioClientId: number;
  altegioDepositId?: number | null;
  directClientId?: string | null;
  title?: string | null;
  balanceHint?: number | null;
  blocked?: boolean;
};

/** Підтягнути/створити рахунок з Altegio (за deposit_id або перший з балансом). */
export async function ensureDepositAccount(params: EnsureDepositAccountParams) {
  const altegioClientId = Number(params.altegioClientId) || 0;
  if (!(altegioClientId > 0)) throw new Error("Немає altegioClientId для завдатку");

  let directClientId = params.directClientId || null;
  if (!directClientId) {
    const linked = await prisma.directClient.findFirst({
      where: { altegioClientId },
      select: { id: true },
    });
    directClientId = linked?.id || null;
  }

  const wantedDepositId = params.altegioDepositId != null ? Number(params.altegioDepositId) : 0;

  // Уже є в Kresco
  if (wantedDepositId > 0) {
    const existing = await prisma.clientDepositAccount.findUnique({
      where: { altegioDepositId: wantedDepositId },
    });
    if (existing) {
      return prisma.clientDepositAccount.update({
        where: { id: existing.id },
        data: {
          directClientId: existing.directClientId || directClientId,
          altegioClientId,
          title: params.title || existing.title,
          blocked: params.blocked ?? existing.blocked,
          isActive: true,
        },
      });
    }
  }

  // Підтягнути з Altegio
  const fetched = await fetchDepositsForClientIds({ clientIds: [altegioClientId] });
  const deposits = fetched.deposits || [];
  const pick =
    (wantedDepositId > 0 ? deposits.find((d) => d.depositId === wantedDepositId) : null) ||
    deposits.find((d) => !d.blocked && d.balance > 0) ||
    deposits.find((d) => !d.blocked) ||
    deposits[0];

  if (!pick) {
    throw new Error("У Altegio немає особистого рахунку для цього клієнта");
  }

  const balance = toMoney(
    params.balanceHint != null && Number.isFinite(Number(params.balanceHint))
      ? Number(params.balanceHint)
      : pick.balance,
  );
  const title = params.title || pick.depositTypeTitle || "Особистий рахунок";

  const existingByAltegio = await prisma.clientDepositAccount.findUnique({
    where: { altegioDepositId: pick.depositId },
  });

  if (existingByAltegio) {
    const updated = await prisma.clientDepositAccount.update({
      where: { id: existingByAltegio.id },
      data: {
        directClientId: existingByAltegio.directClientId || directClientId,
        altegioClientId,
        title,
        balance,
        blocked: pick.blocked,
        isActive: true,
        syncStatus: "synced",
        syncError: null,
        source: "altegio_import",
      },
    });
    return updated;
  }

  const created = await prisma.clientDepositAccount.create({
    data: {
      directClientId,
      altegioClientId,
      altegioDepositId: pick.depositId,
      title,
      balance,
      blocked: pick.blocked,
      isActive: true,
      source: "altegio_import",
      syncStatus: "synced",
    },
  });

  await prisma.clientDepositLedgerEntry.create({
    data: {
      accountId: created.id,
      kind: "import_snapshot",
      amount: balance,
      balanceAfter: balance,
      kyivDay: kyivCalendarTodayYmd(),
      comment: "Імпорт балансу з Altegio",
      source: "altegio",
      syncStatus: "synced",
    },
  });

  console.log(
    `[deposits] Створено рахунок ${created.id} altegioDeposit=${pick.depositId} balance=${balance}`,
  );
  return created;
}

async function markDriftIfNeeded(accountId: string, localBalance: number, altegioBalance: number) {
  const diff = Math.abs(toMoney(localBalance) - toMoney(altegioBalance));
  if (diff > DRIFT_EPS) {
    await prisma.clientDepositAccount.update({
      where: { id: accountId },
      data: {
        syncStatus: "drift",
        syncError: `Розбіжність: Kresco ${toMoney(localBalance)} ≠ Altegio ${toMoney(altegioBalance)}`,
      },
    });
    console.warn(
      `[deposits] drift account=${accountId} kresco=${localBalance} altegio=${altegioBalance}`,
    );
  }
}

export type AppendTopUpParams = {
  altegioClientId: number;
  altegioDepositId: number;
  amount: number;
  balanceAfter?: number | null;
  appointmentId?: string | null;
  directClientId?: string | null;
  altegioDocumentId?: number | null;
  altegioDepositTxId?: number | null;
  altegioPaymentTxId?: number | null;
  kyivDay?: string;
  comment?: string | null;
  createdBy?: string | null;
  title?: string | null;
};

export async function appendDepositTopUp(params: AppendTopUpParams) {
  const amount = toMoney(params.amount);
  if (!(amount > 0)) throw new Error("Сума поповнення має бути > 0");

  if (params.altegioDepositTxId) {
    const dup = await prisma.clientDepositLedgerEntry.findUnique({
      where: { altegioDepositTxId: params.altegioDepositTxId },
    });
    if (dup) {
      console.log(`[deposits] topup вже є tx=${params.altegioDepositTxId}`);
      return dup;
    }
  }

  const account = await ensureDepositAccount({
    altegioClientId: params.altegioClientId,
    altegioDepositId: params.altegioDepositId,
    directClientId: params.directClientId,
    title: params.title,
  });

  const balanceAfter =
    params.balanceAfter != null && Number.isFinite(Number(params.balanceAfter))
      ? toMoney(Number(params.balanceAfter))
      : toMoney(account.balance + amount);

  const entry = await prisma.clientDepositLedgerEntry.create({
    data: {
      accountId: account.id,
      kind: "topup",
      amount,
      balanceAfter,
      salonAppointmentId: params.appointmentId || null,
      altegioDocumentId: params.altegioDocumentId || null,
      altegioDepositTxId: params.altegioDepositTxId || null,
      altegioPaymentTxId: params.altegioPaymentTxId || null,
      kyivDay: params.kyivDay || kyivCalendarTodayYmd(),
      comment: params.comment || null,
      createdBy: params.createdBy || null,
      source: "kresco",
      syncStatus: "synced",
    },
  });

  await prisma.clientDepositAccount.update({
    where: { id: account.id },
    data: { balance: balanceAfter, syncStatus: "synced", syncError: null },
  });

  console.log(
    `[deposits] topup account=${account.id} +${amount} → ${balanceAfter} entry=${entry.id}`,
  );
  return entry;
}

export type AppendSpendParams = {
  altegioClientId: number;
  altegioDepositId: number;
  amount: number;
  balanceAfter?: number | null;
  appointmentId?: string | null;
  checkoutId?: string | null;
  directClientId?: string | null;
  altegioDocumentId?: number | null;
  altegioDepositTxId?: number | null;
  altegioPaymentTxId?: number | null;
  kyivDay?: string;
  comment?: string | null;
  createdBy?: string | null;
  title?: string | null;
};

export async function appendDepositSpend(params: AppendSpendParams) {
  const amount = toMoney(params.amount);
  if (!(amount > 0)) throw new Error("Сума списання має бути > 0");

  if (params.checkoutId) {
    const dup = await prisma.clientDepositLedgerEntry.findFirst({
      where: { salonCheckoutId: params.checkoutId, kind: "spend" },
    });
    if (dup) {
      console.log(`[deposits] spend вже є checkout=${params.checkoutId}`);
      return { entry: dup, accountId: dup.accountId };
    }
  }
  if (params.altegioDepositTxId) {
    const dup = await prisma.clientDepositLedgerEntry.findUnique({
      where: { altegioDepositTxId: params.altegioDepositTxId },
    });
    if (dup) return { entry: dup, accountId: dup.accountId };
  }

  const account = await ensureDepositAccount({
    altegioClientId: params.altegioClientId,
    altegioDepositId: params.altegioDepositId,
    directClientId: params.directClientId,
    title: params.title,
  });

  const balanceAfter =
    params.balanceAfter != null && Number.isFinite(Number(params.balanceAfter))
      ? toMoney(Number(params.balanceAfter))
      : toMoney(account.balance - amount);

  const entry = await prisma.clientDepositLedgerEntry.create({
    data: {
      accountId: account.id,
      kind: "spend",
      amount: -Math.abs(amount),
      balanceAfter,
      salonAppointmentId: params.appointmentId || null,
      salonCheckoutId: params.checkoutId || null,
      altegioDocumentId: params.altegioDocumentId || null,
      altegioDepositTxId: params.altegioDepositTxId || null,
      altegioPaymentTxId: params.altegioPaymentTxId || null,
      kyivDay: params.kyivDay || kyivCalendarTodayYmd(),
      comment: params.comment || null,
      createdBy: params.createdBy || null,
      source: "kresco",
      syncStatus: "synced",
    },
  });

  await prisma.clientDepositAccount.update({
    where: { id: account.id },
    data: { balance: balanceAfter, syncStatus: "synced", syncError: null },
  });

  console.log(
    `[deposits] spend account=${account.id} -${amount} → ${balanceAfter} entry=${entry.id}`,
  );
  return { entry, accountId: account.id };
}

/** Оновити кеш балансу з Altegio і помітити drift. */
export async function refreshDepositAccountFromAltegio(accountId: string) {
  const account = await prisma.clientDepositAccount.findUnique({ where: { id: accountId } });
  if (!account?.altegioClientId || !account.altegioDepositId) return account;

  const fetched = await fetchDepositsForClientIds({ clientIds: [account.altegioClientId] });
  const pick = (fetched.deposits || []).find((d) => d.depositId === account.altegioDepositId);
  if (!pick) return account;

  const altegioBalance = toMoney(pick.balance);
  await markDriftIfNeeded(account.id, account.balance, altegioBalance);

  return prisma.clientDepositAccount.update({
    where: { id: account.id },
    data: {
      balance: altegioBalance,
      blocked: pick.blocked,
      title: pick.depositTypeTitle || account.title,
      syncStatus: Math.abs(account.balance - altegioBalance) > DRIFT_EPS ? "drift" : "synced",
      syncError:
        Math.abs(account.balance - altegioBalance) > DRIFT_EPS
          ? `Розбіжність до оновлення: було ${account.balance}`
          : null,
    },
  });
}

export async function getDepositsForDirectClient(directClientId: string) {
  const client = await prisma.directClient.findUnique({
    where: { id: directClientId },
    select: { id: true, altegioClientId: true },
  });
  if (!client) throw new Error("Клієнта не знайдено");

  let accounts = await prisma.clientDepositAccount.findMany({
    where: {
      OR: [
        { directClientId: client.id },
        ...(client.altegioClientId ? [{ altegioClientId: client.altegioClientId }] : []),
      ],
      isActive: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Якщо порожньо, але є Altegio — підтягнути
  if (accounts.length === 0 && client.altegioClientId && client.altegioClientId > 0) {
    try {
      const fetched = await fetchDepositsForClientIds({ clientIds: [client.altegioClientId] });
      for (const d of fetched.deposits || []) {
        await ensureDepositAccount({
          altegioClientId: client.altegioClientId,
          altegioDepositId: d.depositId,
          directClientId: client.id,
          title: d.depositTypeTitle,
          balanceHint: d.balance,
          blocked: d.blocked,
        });
      }
      accounts = await prisma.clientDepositAccount.findMany({
        where: { directClientId: client.id, isActive: true },
        orderBy: { updatedAt: "desc" },
      });
    } catch (err) {
      console.warn(
        `[deposits] Не вдалося імпортувати для DirectClient ${client.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const accountIds = accounts.map((a) => a.id);
  const ledger =
    accountIds.length === 0
      ? []
      : await prisma.clientDepositLedgerEntry.findMany({
          where: { accountId: { in: accountIds } },
          orderBy: { createdAt: "desc" },
          take: 40,
        });

  const totalBalance = toMoney(accounts.reduce((s, a) => s + (a.blocked ? 0 : a.balance), 0));
  return { accounts, ledger, totalBalance };
}

export async function getDepositsByAltegioClientId(altegioClientId: number) {
  const id = Number(altegioClientId) || 0;
  if (!(id > 0)) throw new Error("Некоректний altegioClientId");

  let accounts = await prisma.clientDepositAccount.findMany({
    where: { altegioClientId: id, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  if (accounts.length === 0) {
    try {
      const fetched = await fetchDepositsForClientIds({ clientIds: [id] });
      for (const d of fetched.deposits || []) {
        await ensureDepositAccount({
          altegioClientId: id,
          altegioDepositId: d.depositId,
          title: d.depositTypeTitle,
          balanceHint: d.balance,
          blocked: d.blocked,
        });
      }
      accounts = await prisma.clientDepositAccount.findMany({
        where: { altegioClientId: id, isActive: true },
        orderBy: { updatedAt: "desc" },
      });
    } catch (err) {
      console.warn(
        `[deposits] Імпорт за altegioClientId=${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const ledger =
    accounts.length === 0
      ? []
      : await prisma.clientDepositLedgerEntry.findMany({
          where: { accountId: { in: accounts.map((a) => a.id) } },
          orderBy: { createdAt: "desc" },
          take: 40,
        });

  return {
    accounts,
    ledger,
    totalBalance: toMoney(accounts.reduce((s, a) => s + (a.blocked ? 0 : a.balance), 0)),
  };
}
