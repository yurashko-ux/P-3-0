// Підсумки інкасації для UI та Telegram (без серверних залежностей).

import {
  formatEncashmentAmount,
  type EncashmentAccountBucket,
} from "@/lib/finance/encashment-account-bucket";

export type EncashmentReceiptPaymentInput = {
  bucket: EncashmentAccountBucket;
  amountUAH: number;
  foreignAmount: number | null;
  status: string;
};

export type EncashmentReceiptAmounts = {
  uah: number;
  usd: number;
  eur: number;
};

export type EncashmentOwnerReceiptTotals = {
  sent: EncashmentReceiptAmounts;
  received: EncashmentReceiptAmounts;
  pending: EncashmentReceiptAmounts;
};

function emptyReceiptAmounts(): EncashmentReceiptAmounts {
  return { uah: 0, usd: 0, eur: 0 };
}

function addPaymentToReceiptAmounts(
  target: EncashmentReceiptAmounts,
  payment: EncashmentReceiptPaymentInput,
): void {
  if (payment.bucket === "usd") {
    target.usd += payment.foreignAmount ?? payment.amountUAH;
    return;
  }
  if (payment.bucket === "eur") {
    target.eur += payment.foreignAmount ?? payment.amountUAH;
    return;
  }
  target.uah += Math.round(payment.amountUAH);
}

export function computeEncashmentOwnerReceiptTotals(
  payments: EncashmentReceiptPaymentInput[],
): EncashmentOwnerReceiptTotals {
  const sent = emptyReceiptAmounts();
  const received = emptyReceiptAmounts();
  const pending = emptyReceiptAmounts();

  for (const payment of payments) {
    if (payment.status === "owner_confirmed") {
      addPaymentToReceiptAmounts(sent, payment);
      addPaymentToReceiptAmounts(received, payment);
    } else if (payment.status === "pending_owner") {
      addPaymentToReceiptAmounts(sent, payment);
      addPaymentToReceiptAmounts(pending, payment);
    }
  }

  return { sent, received, pending };
}

export function formatEncashmentReceiptAmounts(amounts: EncashmentReceiptAmounts): string {
  const parts: string[] = [];
  if (amounts.uah > 0) parts.push(`${formatEncashmentAmount(amounts.uah)} грн.`);
  if (amounts.usd > 0) parts.push(`${formatEncashmentAmount(amounts.usd)} $`);
  if (amounts.eur > 0) parts.push(`${formatEncashmentAmount(amounts.eur)} EUR`);
  return parts.length > 0 ? parts.join(" + ") : "0 грн.";
}

export type EncashmentReceiptDisplay = {
  totalUah: number;
  received: EncashmentReceiptAmounts;
  pending: EncashmentReceiptAmounts;
};

export type EncashmentFactTotals = {
  cashUAH: number;
  fopUAH: number;
  usd: number;
  eur: number;
};

function subtractReceiptAmounts(total: number, received: number): number {
  return Math.max(0, Math.round(total) - Math.round(received));
}

export function buildEncashmentReceiptDisplay(
  totalEncashmentUah: number,
  payments: EncashmentReceiptPaymentInput[],
  factTotals?: EncashmentFactTotals,
): EncashmentReceiptDisplay {
  const receiptTotals = computeEncashmentOwnerReceiptTotals(payments);
  const totalUah = Math.max(0, Math.round(totalEncashmentUah));
  const received = { ...receiptTotals.received };
  const pending: EncashmentReceiptAmounts = {
    uah: subtractReceiptAmounts(totalUah, received.uah),
    usd: factTotals
      ? subtractReceiptAmounts(factTotals.usd, received.usd)
      : receiptTotals.pending.usd,
    eur: factTotals
      ? subtractReceiptAmounts(factTotals.eur, received.eur)
      : receiptTotals.pending.eur,
  };
  return { totalUah, received, pending };
}

export function formatEncashmentReceiptDisplayUah(value: number): string {
  return `${formatEncashmentAmount(Math.max(0, Math.round(value)))} грн.`;
}

export function formatEncashmentReceiptDisplayReceived(display: EncashmentReceiptDisplay): string {
  return formatEncashmentReceiptAmounts(display.received);
}

export function formatEncashmentReceiptDisplayPending(display: EncashmentReceiptDisplay): string {
  return formatEncashmentReceiptAmounts(display.pending);
}
