// Спільна логіка bucket-ів інкасації для фінзвіту та підтвердження.

import type { AltegioFinanceTransaction } from "@/lib/altegio/expenses";

export type EncashmentAccountBucket = "cash_uah" | "fop_uah" | "usd" | "eur";

/** Формат суми: округлення до цілих грн., групи по 3 цифри з пробілом (58 000). */
export function formatEncashmentAmount(value: number): string {
  const rounded = Math.round(value);
  const formatted = new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(rounded);
  return formatted.replace(/[\u00A0\u202F]/g, " ");
}

export type EncashmentAmounts = {
  bucket: EncashmentAccountBucket;
  amountUAH: number;
  foreignAmount: number | null;
  foreignCurrency: "USD" | "EUR" | null;
  displayAmount: string;
};

export function isEncashmentPurposeLabel(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("інкасац") || normalized.includes("инкасац");
}

function normalizeAccountLabel(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isUsdAccountLabel(value: unknown): boolean {
  const normalized = normalizeAccountLabel(value);
  return normalized.includes("долар") || normalized.includes("dollar") || normalized.includes("usd") || normalized.includes("$");
}

export function isEurAccountLabel(value: unknown): boolean {
  const normalized = normalizeAccountLabel(value);
  return normalized.includes("євро") || normalized.includes("евро") || normalized.includes("euro") || normalized.includes("eur") || normalized.includes("€");
}

export function isCashAccountLabel(value: unknown): boolean {
  const normalized = normalizeAccountLabel(value);
  return normalized.includes("каса") || normalized.includes("cash");
}

export function isFopAccountLabel(value: unknown): boolean {
  const normalized = normalizeAccountLabel(value);
  return normalized.includes("фоп") || normalized.includes("fop");
}

function parseLooseNumber(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractCurrencyAmountFromComment(comment: string, currency: "usd" | "eur"): number {
  const raw = String(comment || "").trim();
  if (!raw) return 0;

  const patterns =
    currency === "usd"
      ? [
          /\$\s*([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)/i,
          /([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)\s*\$/i,
          /\busd\b\s*([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)/i,
          /([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)\s*\busd\b/i,
        ]
      : [
          /€\s*([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)/i,
          /([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)\s*€/i,
          /([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)\s*[єЄ]/i,
          /[єЄ]\s*([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)/i,
          /\beur\b\s*([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)/i,
          /([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)\s*\beur\b/i,
          /\bєвро\b\s*([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)/i,
          /([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)\s*\bєвро\b/i,
          /\bевро\b\s*([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)/i,
          /([0-9]+(?:[ \u00A0][0-9]{3})*(?:[.,][0-9]+)?)\s*\bевро\b/i,
        ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const parsed = match?.[1] ? parseLooseNumber(match[1]) : null;
    if (parsed != null && parsed > 0) return parsed;
  }

  return 0;
}

export function getTransactionAccountLabel(transaction: AltegioFinanceTransaction): string {
  return (
    transaction?.account?.title ||
    transaction?.account?.name ||
    ""
  );
}

export function resolveEncashmentAccountBucket(accountLabel: string): EncashmentAccountBucket {
  if (isCashAccountLabel(accountLabel)) return "cash_uah";
  if (isUsdAccountLabel(accountLabel)) return "usd";
  if (isEurAccountLabel(accountLabel)) return "eur";
  if (isFopAccountLabel(accountLabel)) return "fop_uah";
  return "fop_uah";
}

export function resolveEncashmentAmounts(
  transaction: AltegioFinanceTransaction,
  commentOverride?: string,
): EncashmentAmounts {
  const accountLabel = getTransactionAccountLabel(transaction);
  const bucket = resolveEncashmentAccountBucket(accountLabel);
  const amountUAH = Math.abs(Number(transaction?.amount) || 0);
  const comment = String(commentOverride ?? transaction?.comment ?? "").trim();

  if (bucket === "usd") {
    const foreignAmount = extractCurrencyAmountFromComment(comment, "usd");
    return {
      bucket,
      amountUAH,
      foreignAmount: foreignAmount > 0 ? foreignAmount : null,
      foreignCurrency: "USD",
      displayAmount: `${formatEncashmentAmount(foreignAmount > 0 ? foreignAmount : amountUAH)} $`,
    };
  }

  if (bucket === "eur") {
    const foreignAmount = extractCurrencyAmountFromComment(comment, "eur");
    return {
      bucket,
      amountUAH,
      foreignAmount: foreignAmount > 0 ? foreignAmount : null,
      foreignCurrency: "EUR",
      displayAmount: `${formatEncashmentAmount(foreignAmount > 0 ? foreignAmount : amountUAH)} EUR`,
    };
  }

  return {
    bucket,
    amountUAH,
    foreignAmount: null,
    foreignCurrency: null,
    displayAmount: `${formatEncashmentAmount(amountUAH)} грн.`,
  };
}

export function bucketLabelUa(bucket: EncashmentAccountBucket): string {
  switch (bucket) {
    case "cash_uah":
      return "Готівка";
    case "fop_uah":
      return "Безготівка";
    case "usd":
      return "Долар $";
    case "eur":
      return "Євро";
    default:
      return bucket;
  }
}

export function isEncashmentTransaction(transaction: AltegioFinanceTransaction): boolean {
  const purposeTitle =
    transaction?.expense?.title ||
    transaction?.expense?.name ||
    transaction?.expense?.category ||
    "";
  const comment = transaction?.comment || "";
  return isEncashmentPurposeLabel(purposeTitle) || isEncashmentPurposeLabel(comment);
}
