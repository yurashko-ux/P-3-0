// Внутрішній номер банківського платежу. Не плутати з номером зведення.

import { prisma } from "@/lib/prisma";

export function formatBankPaymentNumber(n: number): string {
  return String(Math.trunc(n)).padStart(5, "0");
}

export async function nextBankPaymentNumber(): Promise<number> {
  const max = await prisma.bankStatementItem.aggregate({ _max: { paymentNumber: true } });
  return (max._max.paymentNumber ?? 0) + 1;
}

export function isBankPaymentNumberConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: string }).code) : "";
  if (code !== "P2002") return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String).some((key) => key.includes("paymentNumber"));
  if (typeof target === "string") return target.includes("paymentNumber");
  return false;
}
