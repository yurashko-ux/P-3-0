"use client";

import { useEffect, useMemo, useState } from "react";

export const FINANCE_REPORT_DISCOUNT_EVENT = "finance-report:discount-loaded";

type DiscountLoadedDetail = {
  year: number;
  month: number;
  amount: number;
};

type DiscountAwareAmountProps = {
  year: number;
  month: number;
  baseValue: number;
  operation?: "add" | "subtract";
  discountMultiplier?: number;
  format?: "money" | "percent";
  percentBase?: number;
};

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rounded);
}

function formatPercent(value: number, base: number): string {
  if (!base) return "0.0%";
  return `${((value / base) * 100).toFixed(1)}%`;
}

export function dispatchFinanceReportDiscountLoaded(detail: DiscountLoadedDetail) {
  window.dispatchEvent(new CustomEvent<DiscountLoadedDetail>(FINANCE_REPORT_DISCOUNT_EVENT, { detail }));
}

export function DiscountAwareAmount({
  year,
  month,
  baseValue,
  operation = "add",
  discountMultiplier,
  format = "money",
  percentBase = 0,
}: DiscountAwareAmountProps) {
  const [discountAmount, setDiscountAmount] = useState(0);

  useEffect(() => {
    function onDiscountLoaded(event: Event) {
      const detail = (event as CustomEvent<DiscountLoadedDetail>).detail;
      if (!detail || detail.year !== year || detail.month !== month) return;
      setDiscountAmount(Number(detail.amount) || 0);
    }

    window.addEventListener(FINANCE_REPORT_DISCOUNT_EVENT, onDiscountLoaded);
    return () => window.removeEventListener(FINANCE_REPORT_DISCOUNT_EVENT, onDiscountLoaded);
  }, [year, month]);

  const adjustedValue = useMemo(() => {
    const multiplier = typeof discountMultiplier === "number"
      ? discountMultiplier
      : operation === "subtract"
        ? -1
        : 1;
    return baseValue + multiplier * discountAmount;
  }, [baseValue, discountAmount, discountMultiplier, operation]);

  if (format === "percent") {
    return <>{formatPercent(adjustedValue, percentBase)}</>;
  }

  return <>{formatMoney(adjustedValue)} грн.</>;
}
