// Приховані рахунки Altegio: не показуємо в Касі, оплаті журналу і формі документа.
// Уже записані оплати, фільтр оплат візитів і банк не чіпаємо.

import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";

export type FinanceAccountArchiveRow = {
  id: number;
  title: string;
  hidden: boolean;
};

function isClientDepositTitle(title: string): boolean {
  const t = String(title || "").toLowerCase();
  return /депозит|deposit|рахунок клієнт|personal account|loyalty/.test(t);
}

export async function hiddenFinanceAccountIds(): Promise<Set<number>> {
  const rows = await prisma.hiddenFinanceAccount.findMany({
    select: { altegioAccountId: true },
  });
  return new Set(rows.map((row) => row.altegioAccountId));
}

export async function listFinanceAccountArchive(): Promise<FinanceAccountArchiveRow[]> {
  const [accounts, hidden] = await Promise.all([fetchAltegioAccounts(), hiddenFinanceAccountIds()]);
  return accounts
    .map((account) => ({
      id: Number(account.id) || 0,
      title: account.title,
      hidden: hidden.has(Number(account.id) || 0),
    }))
    .filter((account) => account.id > 0 && !isClientDepositTitle(account.title))
    .sort((a, b) => {
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
      return a.title.localeCompare(b.title, "uk");
    });
}

export async function setFinanceAccountHidden(input: {
  accountId: number;
  title?: string | null;
  hidden: boolean;
  hiddenBy?: string | null;
}): Promise<void> {
  const accountId = Number(input.accountId) || 0;
  if (!(accountId > 0)) throw new Error("Немає id рахунку");
  const title = String(input.title || "").trim() || `Рахунок #${accountId}`;
  if (input.hidden) {
    await prisma.hiddenFinanceAccount.upsert({
      where: { altegioAccountId: accountId },
      create: {
        altegioAccountId: accountId,
        title,
        hiddenBy: input.hiddenBy || null,
      },
      update: { title, hiddenAt: new Date(), hiddenBy: input.hiddenBy || null },
    });
    console.log(`[finance/accounts] Рахунок ${accountId} «${title}» в архіві`);
    return;
  }
  await prisma.hiddenFinanceAccount.deleteMany({ where: { altegioAccountId: accountId } });
  console.log(`[finance/accounts] Рахунок ${accountId} «${title}» повернуто з архіву`);
}
