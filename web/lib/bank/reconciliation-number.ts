import { prisma } from "@/lib/prisma";

const LINKED_STATUSES = new Set(["auto_matched", "manual_matched"]);

/** З цієї дати (київський день) зведені вхідні показуємо в розділі Банк як у вихідних. */
export const BANK_INCOMING_RECONCILE_MARK_START_DAY = "2026-07-01";

export function isIncomingReconcileMarkDay(kyivDay: string | null | undefined): boolean {
  return Boolean(kyivDay && kyivDay >= BANK_INCOMING_RECONCILE_MARK_START_DAY);
}

export function isLinkedIncomingMatchStatus(status: string | null | undefined): boolean {
  return status === "auto_matched" || status === "manual_matched";
}

async function nextSharedReconciliationNumber(): Promise<number> {
  const [outgoingMax, incomingMax] = await Promise.all([
    (prisma as any).bankAltegioPaymentMatch.aggregate({
      _max: { reconciliationNumber: true },
    }),
    (prisma as any).bankAltegioIncomingMatch.aggregate({
      _max: { reconciliationNumber: true },
    }),
  ]);
  const maxOutgoing = outgoingMax._max.reconciliationNumber ?? 0;
  const maxIncoming = incomingMax._max.reconciliationNumber ?? 0;
  return Math.max(maxOutgoing, maxIncoming) + 1;
}

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
    const next = await nextSharedReconciliationNumber();
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

/**
 * № зведення для вхідного платежу (розділ Банк), лише з BANK_INCOMING_RECONCILE_MARK_START_DAY.
 */
export async function ensureIncomingReconciliationNumber(
  bankStatementItemId: string,
): Promise<number | null> {
  const match = await (prisma as any).bankAltegioIncomingMatch.findUnique({
    where: { bankStatementItemId },
    select: { id: true, status: true, kyivDay: true, reconciliationNumber: true },
  });
  if (!match || !isLinkedIncomingMatchStatus(match.status)) {
    return match?.reconciliationNumber ?? null;
  }
  if (!isIncomingReconcileMarkDay(match.kyivDay)) {
    return match.reconciliationNumber ?? null;
  }
  if (match.reconciliationNumber != null) {
    return match.reconciliationNumber;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const next = await nextSharedReconciliationNumber();
    const updated = await (prisma as any).bankAltegioIncomingMatch.updateMany({
      where: { id: match.id, reconciliationNumber: null },
      data: { reconciliationNumber: next },
    });
    if (updated.count > 0) {
      console.log("[bank/reconciliation-number] Присвоєно № зведення вхідному платежу", {
        bankStatementItemId,
        reconciliationNumber: next,
        kyivDay: match.kyivDay,
      });
      return next;
    }
    const refreshed = await (prisma as any).bankAltegioIncomingMatch.findUnique({
      where: { id: match.id },
      select: { reconciliationNumber: true },
    });
    if (refreshed?.reconciliationNumber != null) {
      return refreshed.reconciliationNumber;
    }
  }

  console.warn("[bank/reconciliation-number] Не вдалося присвоїти № зведення вхідному:", {
    bankStatementItemId,
  });
  return null;
}
