// Логіка колонок «Майстер консультацій» та «Майстер запису» у Direct (без змішування пріоритетів).

import type { DirectClient } from "@/lib/direct-types";
import { shortPersonName } from "@/app/admin/direct/_components/direct-client-table-formatters";
import { firstToken } from "@/lib/master-filter-utils";

type BreakdownItem = { masterName: string; sumUAH: number };

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
