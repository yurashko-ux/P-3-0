"use client";

/**
 * Стандарт відображення ПІБ клієнта в усій адмінці:
 * [бейдж лояльності за spent] Імʼя Прізвище (visits)
 * — як у Direct у колонці «Імʼя».
 */

import type { ReactNode } from "react";
import {
  SpendCircleBadge,
  SpendMegaBadge,
  SpendStarBadge,
} from "@/app/admin/direct/_components/DirectClientTableRowBadges";

function spendValueOf(spent?: number | null): number {
  if (typeof spent === "number") return Number.isFinite(spent) ? spent : 0;
  const num = Number(spent);
  return Number.isFinite(num) ? num : 0;
}

function moneyUa(n: number) {
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Жовтий кружечок / зірочка за DirectClient.spent (ті самі пороги, що в Direct). */
export function ClientSpendLoyaltyBadge({
  spent,
  size = "sm",
  className = "",
}: {
  spent?: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const spendValue = spendValueOf(spent);
  const badgeSize = size === "md" ? 18 : 16;
  const spendShowMega = spendValue > 1_000_000;
  const spendShowStar = spendValue >= 100_000;
  const spendShowCircleTen = spendValue >= 20_000 && spendValue < 100_000;
  const spendShowCircleOne = spendValue >= 10_000 && spendValue < 20_000;
  const spendCircleRaw = Math.floor(spendValue / 10_000);
  const spendCircleNumber = Math.min(9, Math.max(2, spendCircleRaw));
  const spendStarRaw = Math.floor(spendValue / 100_000);
  const spendStarNumber = Math.min(9, Math.max(1, spendStarRaw));
  const spendShowStarNumber = spendValue > 200_000;
  const title = `Витрати: ${moneyUa(spendValue)} ₴`;

  let badge: ReactNode;
  if (spendShowMega) {
    badge = <SpendMegaBadge />;
  } else if (spendShowStar) {
    badge = (
      <SpendStarBadge
        size={spendShowStarNumber ? (size === "md" ? 22 : 20) : badgeSize}
        number={spendShowStarNumber ? spendStarNumber : undefined}
        fontSize={spendShowStarNumber ? 8 : size === "md" ? 12 : 11}
      />
    );
  } else if (spendShowCircleTen) {
    badge = <SpendCircleBadge size={badgeSize} number={spendCircleNumber} />;
  } else if (spendShowCircleOne) {
    badge = <SpendCircleBadge size={badgeSize} number={1} />;
  } else {
    badge = <SpendCircleBadge size={badgeSize} />;
  }

  return (
    <span title={title} className={`inline-flex shrink-0 items-center ${className}`} aria-label={title}>
      {badge}
    </span>
  );
}

export function buildClientDisplayName(parts: {
  firstName?: string | null;
  lastName?: string | null;
  clientName?: string | null;
  fallback?: string | null;
}): string {
  const fromParts = [parts.lastName, parts.firstName].filter(Boolean).join(" ").trim();
  if (fromParts) return fromParts;
  const snap = String(parts.clientName || "").trim();
  if (snap) return snap;
  return String(parts.fallback || "").trim() || "Клієнт";
}

export function ClientNameWithLoyalty({
  name,
  spent,
  visits,
  size = "sm",
  className = "",
  nameClassName = "",
  showBadge = true,
}: {
  /** Готове ПІБ (або нік, якщо ПІБ немає). */
  name: string;
  spent?: number | null;
  visits?: number | null;
  size?: "sm" | "md";
  className?: string;
  nameClassName?: string;
  /** Якщо false — лише текст ПІБ (visits), без бейджа. */
  showBadge?: boolean;
}) {
  const label = String(name || "").trim() || "Клієнт";
  const visitsSuffix =
    visits !== null && visits !== undefined && Number.isFinite(Number(visits))
      ? ` (${Number(visits)})`
      : "";

  return (
    <span className={`inline-flex items-start gap-1.5 min-w-0 ${className}`}>
      {showBadge ? <ClientSpendLoyaltyBadge spent={spent} size={size} className="mt-0.5" /> : null}
      <span className={`min-w-0 ${nameClassName}`}>
        {label}
        {visitsSuffix ? <span className="opacity-80 font-normal">{visitsSuffix}</span> : null}
      </span>
    </span>
  );
}
