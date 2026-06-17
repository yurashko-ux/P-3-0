import { prisma } from "@/lib/prisma";

const LINKED_STATUSES = new Set(["auto_matched", "manual_matched"]);

/** Присвоює постійний № зведення при першому auto/manual match (не змінюється при unmatch). */
export async function ensureReconciliationNumber(bankStatementItemId: string): Promise<number | null> {
  const match = await (prisma as any).bankAltegioPaymentMatch.findUnique({
    where: { bankStatementItemId },
    select: { id: true, status: true, reconciliationNumber: true },
  });
  if (!match || !LINKED_STATUSES.has(match.status)) {
    return match?.reconciliationNumber ?? null;
  }
  if (match.reconciliationNumber != null) {
    return match.reconciliationNumber;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const maxRow = await (prisma as any).bankAltegioPaymentMatch.aggregate({
      _max: { reconciliationNumber: true },
    });
    const next = (maxRow._max.reconciliationNumber ?? 0) + 1;
    const updated = await (prisma as any).bankAltegioPaymentMatch.updateMany({
      where: { id: match.id, reconciliationNumber: null },
      data: { reconciliationNumber: next },
    });
    if (updated.count > 0) {
      const { deleteReconciledPaymentTelegramMessages } = await import(
        "@/lib/bank/payment-reconciliation-telegram"
      );
      await deleteReconciledPaymentTelegramMessages(bankStatementItemId, {
        kinds: ["needs_review"],
      }).catch((error) => {
        console.warn("[bank/reconciliation-number] Не вдалося видалити Telegram-повідомлення після зведення:", {
          bankStatementItemId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return next;
    }
    const refreshed = await (prisma as any).bankAltegioPaymentMatch.findUnique({
      where: { id: match.id },
      select: { reconciliationNumber: true },
    });
    if (refreshed?.reconciliationNumber != null) {
      return refreshed.reconciliationNumber;
    }
  }

  console.warn("[bank/reconciliation-number] Не вдалося присвоїти № зведення:", { bankStatementItemId });
  return null;
}
