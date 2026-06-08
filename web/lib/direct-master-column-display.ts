// Логіка колонок «Майстер консультацій» та «Майстер запису» у Direct (без змішування пріоритетів).

import type { DirectClient } from "@/lib/direct-types";
import { shortPersonName } from "@/app/admin/direct/_components/direct-client-table-formatters";
import { firstToken } from "@/lib/master-filter-utils";

export type BreakdownItem = { masterName: string; sumUAH: number };

/**
 * Multi-record візит: одна й та сама сума на кожного майстра (дубль послуг) → беремо один раз.
 * Як у «Історії записів» (послуги візиту без повторів).
 */
export function collapseInflatedBreakdownSum(breakdown: BreakdownItem[]): number {
  const sums = breakdown.map((b) => b.sumUAH).filter((s) => s > 0);
  if (sums.length === 0) return 0;
  if (sums.length === 1) return sums[0];
  const first = sums[0];
  const tolerance = Math.max(100, Math.round(first * 0.05));
  const allEqual = sums.every((s) => Math.abs(s - first) <= tolerance);
  if (allEqual) return first;
  return sums.reduce((a, b) => a + b, 0);
}

function isBreakdownInflatedMultiMaster(breakdown: BreakdownItem[]): boolean {
  if (breakdown.length < 2) return false;
  const naive = breakdown.reduce((a, b) => a + b.sumUAH, 0);
  const collapsed = collapseInflatedBreakdownSum(breakdown);
  return collapsed > 0 && naive > collapsed * 1.5;
}

/** Сума для колонки «Запис» — узгоджено з історією, без дублювання multi-master. */
export function resolvePaidRecordColumnSum(client: DirectClient): {
  displaySum: number | null;
  displayLabel: string;
  hasBreakdown: boolean;
} {
  const breakdownRaw = client.paidServiceVisitBreakdown as BreakdownItem[] | undefined;
  const breakdown = Array.isArray(breakdownRaw) ? breakdownRaw : [];
  const rawHasBreakdown = breakdown.length > 0;
  const naiveTotal = rawHasBreakdown ? breakdown.reduce((a, b) => a + b.sumUAH, 0) : 0;
  const inflated = rawHasBreakdown && isBreakdownInflatedMultiMaster(breakdown);
  const effectiveTotal = inflated ? collapseInflatedBreakdownSum(breakdown) : naiveTotal;
  const ptc = typeof client.paidServiceTotalCost === "number" ? client.paidServiceTotalCost : null;
  const spent = typeof client.spent === "number" ? client.spent : 0;

  const breakdownMismatch =
    rawHasBreakdown &&
    !inflated &&
    ((ptc != null && ptc > 0 && Math.abs(effectiveTotal - ptc) > Math.max(1000, ptc * 0.15)) ||
      (spent > 0 && effectiveTotal > spent * 2));

  const hasBreakdown = rawHasBreakdown && !breakdownMismatch && effectiveTotal > 0;
  let displaySum: number | null = null;
  if (hasBreakdown) {
    displaySum = effectiveTotal;
  } else if (inflated && effectiveTotal > 0) {
    displaySum = effectiveTotal;
  } else if (ptc != null && ptc > 0) {
    displaySum = ptc;
  }

  return {
    displaySum,
    displayLabel: hasBreakdown ? "Сума по майстрах" : "Сума запису",
    hasBreakdown,
  };
}

/** Ім'я майстра консультації з Altegio (consultationMasterName). */
export function getConsultationMasterDisplay(client: DirectClient): string {
  const raw = (client.consultationMasterName || "").trim();
  return raw ? shortPersonName(raw) : "";
}

export type RecordMasterDisplay = {
  hasContent: boolean;
  primaryName: string;
  displayLines: string[];
  hasBreakdown: boolean;
  secondaryName: string;
  historyTitle: string;
};

function isBreakdownMismatch(client: DirectClient, breakdown: BreakdownItem[]): boolean {
  if (isBreakdownInflatedMultiMaster(breakdown)) return false;
  const totalFromBreakdown = breakdown.reduce((a, b) => a + b.sumUAH, 0);
  const ptc = typeof client.paidServiceTotalCost === "number" ? client.paidServiceTotalCost : null;
  const spent = typeof client.spent === "number" ? client.spent : 0;
  return (
    (ptc != null && ptc > 0 && Math.abs(totalFromBreakdown - ptc) > Math.max(1000, ptc * 0.15)) ||
    (spent > 0 && totalFromBreakdown > spent * 2)
  );
}

/** Майстер(и) платного запису з Altegio — без урахування consultationMasterName. */
export function getRecordMasterDisplay(client: DirectClient): RecordMasterDisplay {
  const empty: RecordMasterDisplay = {
    hasContent: false,
    primaryName: "",
    displayLines: [],
    hasBreakdown: false,
    secondaryName: "",
    historyTitle: "",
  };

  const full = (client.serviceMasterName || "").trim();
  const breakdownRaw = client.paidServiceVisitBreakdown as BreakdownItem[] | undefined;
  const breakdownArr = Array.isArray(breakdownRaw) ? breakdownRaw : [];
  const mismatch = breakdownArr.length > 0 && isBreakdownMismatch(client, breakdownArr);
  const hasBreakdown = breakdownArr.length > 0 && Boolean(client.paidServiceDate) && !mismatch;
  const paidMasterName = shortPersonName(full) || (hasBreakdown ? shortPersonName(breakdownArr[0].masterName) : "");
  const showPaidMaster = Boolean(client.paidServiceDate && paidMasterName);

  if (!showPaidMaster) return empty;

  const secondaryFull = ((client as { serviceSecondaryMasterName?: string }).serviceSecondaryMasterName || "").trim();
  const secondary = shortPersonName(secondaryFull);

  let displayLines: string[];
  if (hasBreakdown) {
    const sorted = [...breakdownArr].sort((a, b) =>
      firstToken(a.masterName).toLowerCase().localeCompare(firstToken(b.masterName).toLowerCase())
    );
    displayLines = sorted.map((b) => shortPersonName(b.masterName)).filter(Boolean);
  } else {
    displayLines = [paidMasterName];
  }

  let historyTitle = paidMasterName;
  try {
    const raw = client.serviceMasterHistory ? JSON.parse(client.serviceMasterHistory) : null;
    if (Array.isArray(raw) && raw.length) {
      const last5 = raw.slice(-5);
      historyTitle =
        `${paidMasterName}\n\nІсторія змін (останні 5):\n` +
        last5
          .map(
            (h: { kyivDay?: string; masterName?: string }) =>
              `${h.kyivDay || "-"} — ${shortPersonName(h.masterName) || "-"}`
          )
          .join("\n");
    }
  } catch {
    // ignore
  }

  return {
    hasContent: true,
    primaryName: paidMasterName,
    displayLines,
    hasBreakdown,
    secondaryName:
      secondary && secondary.toLowerCase() !== paidMasterName.toLowerCase() ? secondary : "",
    historyTitle,
  };
}

/** Список імен для Telegram / API — колонка «Майстер консультацій». */
export function getConsultationMasterColumnNames(client: DirectClient): string[] {
  const name = getConsultationMasterDisplay(client);
  return name ? [name] : [];
}

/** Список імен для Telegram / API — колонка «Майстер запису». */
export function getRecordMasterColumnNames(client: DirectClient): string[] {
  const d = getRecordMasterDisplay(client);
  if (!d.hasContent) return [];
  if (d.hasBreakdown) return d.displayLines;
  if (d.secondaryName) return [d.primaryName, d.secondaryName];
  return d.primaryName ? [d.primaryName] : [];
}
