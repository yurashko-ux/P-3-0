// web/lib/consultation-list-styles.ts
// Кольори рядків і групування по днях для сторінки «Консультації».

import { kyivDayFromISO } from "@/lib/altegio/records-grouping";

export type ConsultationOutcome = "realized" | "cancelled" | "no_show" | "planned";

export type ConsultationListOutcomeOverride = "thinking" | "positive" | "negative" | null;

export type ConsultationRowColorKey = "planned" | "positive" | "negative" | "thinking" | "no_show";

export const CONSULTATION_ROW_BG: Record<ConsultationRowColorKey, string> = {
  planned: "bg-yellow-100 hover:bg-yellow-100",
  positive: "bg-green-100 hover:bg-green-100",
  negative: "bg-red-100 hover:bg-red-100",
  thinking: "bg-sky-100 hover:bg-sky-100",
  no_show: "bg-purple-100 hover:bg-purple-100",
};

export function getConsultationRowColorKey(client: {
  outcome: ConsultationOutcome;
  consultationListOutcomeOverride?: string | null;
  signedUpForPaidService?: boolean;
  signedUpForPaidServiceAfterConsultation?: boolean;
}): ConsultationRowColorKey {
  const manual = (client.consultationListOutcomeOverride || "").trim();
  if (manual === "thinking") return "thinking";
  if (manual === "positive") return "positive";
  if (manual === "negative") return "negative";

  if (client.outcome === "planned") return "planned";
  if (client.outcome === "no_show") return "no_show";
  if (client.outcome === "cancelled") return "negative";
  if (client.outcome === "realized") {
    if (client.signedUpForPaidService || client.signedUpForPaidServiceAfterConsultation) {
      return "positive";
    }
    return "negative";
  }
  return "planned";
}

export function formatConsultationDayLabel(kyivDay: string, todayKyiv: string): string {
  const [y, m, d] = kyivDay.split("-");
  const short = `${d}.${m}.${y.slice(2)}`;
  if (kyivDay === todayKyiv) return `Сьогодні ${short}`;
  return short;
}

export type ConsultationTableRow =
  | { type: "day-separator"; kyivDay: string; label: string; isToday: boolean }
  | { type: "client"; kyivDay: string; clientId: string };

/** Групує клієнтів по днях consultationBookingDate (Kyiv), від старіших до новіших. */
export function buildConsultationTableRows(
  clients: Array<{ id: string; consultationBookingDate: string | null }>,
  todayKyiv: string
): ConsultationTableRow[] {
  const sorted = [...clients].sort((a, b) => {
    const da = kyivDayFromISO(a.consultationBookingDate || "") || "";
    const db = kyivDayFromISO(b.consultationBookingDate || "") || "";
    if (da !== db) return da.localeCompare(db);
    return (a.consultationBookingDate || "").localeCompare(b.consultationBookingDate || "");
  });

  const out: ConsultationTableRow[] = [];
  let lastDay = "";
  for (const c of sorted) {
    const day = kyivDayFromISO(c.consultationBookingDate || "") || "unknown";
    if (day !== lastDay) {
      out.push({
        type: "day-separator",
        kyivDay: day,
        label: formatConsultationDayLabel(day, todayKyiv),
        isToday: day === todayKyiv,
      });
      lastDay = day;
    }
    out.push({ type: "client", kyivDay: day, clientId: c.id });
  }
  return out;
}
