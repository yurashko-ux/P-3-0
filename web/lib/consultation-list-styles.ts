// web/lib/consultation-list-styles.ts
// Кольори рядків і групування по днях для сторінки «Консультації».

import { kyivDayFromISO } from "@/lib/altegio/records-grouping";

export type ConsultationOutcome = "realized" | "cancelled" | "no_show" | "planned";

export type ConsultationListOutcomeOverride =
  | "planned"
  | "positive"
  | "negative"
  | "thinking"
  | "cancelled"
  | "no_show"
  | null;

export type ConsultationResultValue =
  | "planned"
  | "positive"
  | "negative"
  | "thinking"
  | "cancelled"
  | "no_show";

export const CONSULTATION_RESULT_OPTIONS: Array<{ value: ConsultationResultValue; label: string }> = [
  { value: "planned", label: "Заплановано" },
  { value: "positive", label: "Позитивно" },
  { value: "negative", label: "Негативно" },
  { value: "thinking", label: "Думає" },
  { value: "cancelled", label: "Скасувала" },
  { value: "no_show", label: "Не прийшла" },
];

export function getAutoConsultationResultValue(client: {
  outcome: ConsultationOutcome;
  signedUpForPaidService?: boolean;
  signedUpForPaidServiceAfterConsultation?: boolean;
}): ConsultationResultValue {
  if (client.outcome === "planned") return "planned";
  if (client.outcome === "cancelled") return "cancelled";
  if (client.outcome === "no_show") return "no_show";
  if (client.outcome === "realized") {
    if (client.signedUpForPaidService || client.signedUpForPaidServiceAfterConsultation) {
      return "positive";
    }
    return "negative";
  }
  return "planned";
}

export function getEffectiveConsultationResultValue(client: {
  consultationListOutcomeOverride?: string | null;
  outcome: ConsultationOutcome;
  signedUpForPaidService?: boolean;
  signedUpForPaidServiceAfterConsultation?: boolean;
}): ConsultationResultValue {
  const manual = (client.consultationListOutcomeOverride || "").trim();
  const allowed = new Set<string>(CONSULTATION_RESULT_OPTIONS.map((o) => o.value));
  if (manual && allowed.has(manual)) return manual as ConsultationResultValue;
  return getAutoConsultationResultValue(client);
}

/** null = залишити авто (поточний статус з Altegio). */
export function consultationOverrideFromResultSelection(
  selected: ConsultationResultValue,
  auto: ConsultationResultValue
): string | null {
  return selected === auto ? null : selected;
}

export type ConsultationRowColorKey = "lead" | "planned" | "positive" | "negative" | "thinking" | "no_show";

export const CONSULTATION_ROW_BG: Record<ConsultationRowColorKey, string> = {
  lead: "bg-slate-100 hover:bg-slate-100",
  planned: "bg-yellow-100 hover:bg-yellow-100",
  positive: "bg-green-100 hover:bg-green-100",
  negative: "bg-red-100 hover:bg-red-100",
  thinking: "bg-sky-100 hover:bg-sky-100",
  no_show: "bg-purple-100 hover:bg-purple-100",
};

/** Фон select/input у рядку — без hover, збігається з CONSULTATION_ROW_BG. */
export const CONSULTATION_CONTROL_BG: Record<ConsultationRowColorKey, string> = {
  lead: "bg-slate-100",
  planned: "bg-yellow-100",
  positive: "bg-green-100",
  negative: "bg-red-100",
  thinking: "bg-sky-100",
  no_show: "bg-purple-100",
};

/** Hex для <option> — браузери краще підхоплюють inline style, ніж Tailwind-класи. */
export const CONSULTATION_RESULT_OPTION_BG: Record<ConsultationResultValue, string> = {
  planned: "#fef9c3",
  positive: "#dcfce7",
  negative: "#fee2e2",
  thinking: "#e0f2fe",
  cancelled: "#fee2e2",
  no_show: "#f3e8ff",
};

export function consultationControlBgHex(colorKey: ConsultationRowColorKey): string {
  const byKey: Record<ConsultationRowColorKey, ConsultationResultValue | "lead"> = {
    lead: "lead",
    planned: "planned",
    positive: "positive",
    negative: "negative",
    thinking: "thinking",
    no_show: "no_show",
  };
  const key = byKey[colorKey];
  if (key === "lead") return "#f1f5f9";
  return CONSULTATION_RESULT_OPTION_BG[key];
}

/** Дата для сортування/групування: консультація в місяці, інакше перший контакт. */
export function getConsultationListSortIso(client: {
  consultationBookingDate?: string | null;
  firstContactDate?: string | null;
}): string {
  return client.consultationBookingDate || client.firstContactDate || "";
}

export function getConsultationRowColorKey(client: {
  consultationBookingDate?: string | null;
  outcome: ConsultationOutcome;
  consultationListOutcomeOverride?: string | null;
  signedUpForPaidService?: boolean;
  signedUpForPaidServiceAfterConsultation?: boolean;
}): ConsultationRowColorKey {
  const manual = (client.consultationListOutcomeOverride || "").trim();
  if (manual === "thinking") return "thinking";
  if (manual === "positive") return "positive";
  if (manual === "negative") return "negative";
  if (manual === "cancelled") return "negative";
  if (manual === "no_show") return "no_show";
  if (manual === "planned") return "planned";

  if (!client.consultationBookingDate) return "lead";

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

/** «5 лідів», «2 ліди», «1 лід» — для підпису біля дати. */
export function formatLeadsCountLabel(count: number): string {
  const n = Math.max(0, count);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} лід`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} ліди`;
  return `${n} лідів`;
}

export function formatConsultationDayLabelWithCount(
  kyivDay: string,
  todayKyiv: string,
  count: number
): string {
  return `${formatConsultationDayLabel(kyivDay, todayKyiv)} (${formatLeadsCountLabel(count)})`;
}

export type ConsultationTableRow =
  | { type: "day-separator"; kyivDay: string; label: string; isToday: boolean }
  | { type: "client"; kyivDay: string; clientId: string };

/** Групує по днях (consultationBookingDate або firstContactDate), від новіших до старіших. */
export function buildConsultationTableRows(
  clients: Array<{
    id: string;
    consultationBookingDate?: string | null;
    firstContactDate?: string | null;
  }>,
  todayKyiv: string
): ConsultationTableRow[] {
  const sorted = [...clients].sort((a, b) => {
    const sa = getConsultationListSortIso(a);
    const sb = getConsultationListSortIso(b);
    const da = kyivDayFromISO(sa) || "";
    const db = kyivDayFromISO(sb) || "";
    if (da !== db) return db.localeCompare(da);
    return sb.localeCompare(sa);
  });

  const countByDay = new Map<string, number>();
  for (const c of clients) {
    const day = kyivDayFromISO(getConsultationListSortIso(c)) || "unknown";
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
  }

  const out: ConsultationTableRow[] = [];
  let lastDay = "";
  for (const c of sorted) {
    const day = kyivDayFromISO(getConsultationListSortIso(c)) || "unknown";
    if (day !== lastDay) {
      out.push({
        type: "day-separator",
        kyivDay: day,
        label: formatConsultationDayLabelWithCount(day, todayKyiv, countByDay.get(day) ?? 0),
        isToday: day === todayKyiv,
      });
      lastDay = day;
    }
    out.push({ type: "client", kyivDay: day, clientId: c.id });
  }
  return out;
}
