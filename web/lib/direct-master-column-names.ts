// web/lib/direct-master-column-names.ts
// Ті самі імена майстрів, що в колонці «Майстер» у DirectClientTableRow (для Telegram тощо).

import type { DirectClient } from "@/lib/direct-types";
import { shortPersonName } from "@/app/admin/direct/_components/direct-client-table-formatters";
import { firstToken } from "@/lib/master-filter-utils";

type MasterRef = { id: string; name: string };

/**
 * Повертає список імен (короткий формат) у тому ж порядку, що й у таблиці:
 * breakdown → кілька рядків; або платний + другий майстер; або один майстер.
 */
export function getMasterColumnNamesLikeTable(client: DirectClient, masters: MasterRef[]): string[] {
  const full = (client.serviceMasterName || "").trim();
  const breakdown = client.paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[] | undefined;
  const totalFromBreakdownM =
    Array.isArray(breakdown) && breakdown.length > 0 ? breakdown.reduce((a, b) => a + b.sumUAH, 0) : 0;
  const ptcM = typeof client.paidServiceTotalCost === "number" ? client.paidServiceTotalCost : null;
  const spentM = typeof client.spent === "number" ? client.spent : 0;
  const breakdownMismatchM =
    Array.isArray(breakdown) &&
    breakdown.length > 0 &&
    ((ptcM != null && ptcM > 0 && Math.abs(totalFromBreakdownM - ptcM) > Math.max(1000, ptcM * 0.15)) ||
      (spentM > 0 && totalFromBreakdownM > spentM * 2));

  const hasBreakdown =
    Array.isArray(breakdown) && breakdown.length > 0 && client.paidServiceDate && !breakdownMismatchM;

  const consultationPrimary = (client.consultationMasterName || "").trim()
    ? firstToken((client.consultationMasterName || "").toString().trim()).toLowerCase()
    : "";

  const paidMasterName = shortPersonName(full) || (hasBreakdown ? shortPersonName(breakdown![0].masterName) : "");
  const responsibleRaw = client.masterId ? masters.find((m) => m.id === client.masterId)?.name || "" : "";
  const responsibleName = shortPersonName(responsibleRaw);

  const consultMasterRaw = (client.consultationMasterName || "").trim();
  const consultMasterDisplay = consultMasterRaw ? shortPersonName(consultMasterRaw) : "";

  const showPaidMaster = Boolean(client.paidServiceDate && paidMasterName);
  const showConsultationAltegioMaster = Boolean(consultMasterDisplay && !showPaidMaster);
  const showResponsibleMaster = Boolean(!showPaidMaster && !showConsultationAltegioMaster && responsibleName);

  if (!showPaidMaster && !showConsultationAltegioMaster && !showResponsibleMaster) {
    return [];
  }

  const secondaryFull = ((client as { serviceSecondaryMasterName?: string }).serviceSecondaryMasterName || "").trim();
  const secondary = shortPersonName(secondaryFull);

  const name = showPaidMaster
    ? paidMasterName
    : showConsultationAltegioMaster
      ? consultMasterDisplay
      : responsibleName;

  if (hasBreakdown) {
    const sorted = [...breakdown!].sort((a, b) => {
      const aFirst = firstToken(a.masterName).toLowerCase();
      const bFirst = firstToken(b.masterName).toLowerCase();
      if (consultationPrimary && aFirst === consultationPrimary) return -1;
      if (consultationPrimary && bFirst === consultationPrimary) return 1;
      return aFirst.localeCompare(bFirst);
    });
    return sorted.map((b) => shortPersonName(b.masterName)).filter(Boolean);
  }

  if (showPaidMaster && secondary && secondary.toLowerCase().trim() !== name.toLowerCase().trim()) {
    return [name, secondary].filter(Boolean);
  }

  return name ? [name] : [];
}
