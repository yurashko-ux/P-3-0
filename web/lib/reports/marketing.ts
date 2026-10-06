// Маркетинговий звіт для групи агенції.
// Воронка (консультації, платні) — лише зірочка (agency_1, Агенція 2).
// Нові ліди — усі джерела, з Instagram-посиланням на кожного ліда.

import { getAllDirectClients } from "@/lib/direct-store";
import {
  clientCountsTowardNewLeadsKpi,
  getKyivDayUtcBounds,
  getPreviousKyivDay,
  toKyivDay,
} from "@/lib/direct-stats-config";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import {
  formatLeadInstagramTelegramLine,
  leadInstagramLink,
  splitTelegramHtml,
  type LeadInstagramLink,
} from "@/lib/reports/lead-instagram-links";
import type { DirectClient } from "@/lib/direct-types";

export type MarketingReportKind = "day" | "week" | "month";

/** agency_heart = Агенція 1 (agency_2), agency_star = Агенція 2 (agency_1), organic = решта. */
export type MarketingLeadSourceKey = "agency_heart" | "agency_star" | "organic";

export type MarketingLeadLink = LeadInstagramLink;

export type MarketingLeadSourceGroup = {
  key: MarketingLeadSourceKey;
  label: string;
  leads: MarketingLeadLink[];
};

export type MarketingReportData = {
  kind: MarketingReportKind;
  from: string;
  to: string;
  /** Нові ліди зі зірочкою (agency_1). */
  leads: number;
  leadSources: MarketingLeadSourceGroup[];
  consultationsCreated: number;
  consultationsAttended: number;
  consultationsNoShow: number;
  paidRecordsCreated: number;
};

const LEAD_SOURCES: Array<{ key: MarketingLeadSourceKey; label: string }> = [
  { key: "agency_heart", label: "Агенція 1♥" },
  { key: "agency_star", label: "Агенція 2*" },
  { key: "organic", label: "Органіка" },
];

function inRange(day: string, from: string, to: string): boolean {
  return Boolean(day) && day >= from && day <= to;
}

function shiftKyivDay(ymd: string, deltaDays: number): string {
  if (deltaDays === 0) return ymd;
  if (deltaDays < 0) {
    let day = ymd;
    for (let i = 0; i < -deltaDays; i += 1) day = getPreviousKyivDay(day);
    return day;
  }
  let day = ymd;
  for (let i = 0; i < deltaDays; i += 1) {
    const { endUtc } = getKyivDayUtcBounds(day);
    day = kyivDayFromISO(endUtc.toISOString());
  }
  return day;
}

/** 1 = понеділок … 7 = неділя, календарний день Kyiv. */
export function kyivWeekdayMon1(ymd: string): number {
  const { startUtc } = getKyivDayUtcBounds(ymd);
  const noon = new Date(startUtc.getTime() + 12 * 60 * 60 * 1000);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    weekday: "short",
  }).format(noon);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[label] ?? 0;
}

export function formatKyivDayUa(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

export function marketingPeriodsForRunDay(runKyivDay: string): Array<{
  kind: MarketingReportKind;
  from: string;
  to: string;
}> {
  const yesterday = getPreviousKyivDay(runKyivDay);
  const periods: Array<{ kind: MarketingReportKind; from: string; to: string }> = [
    { kind: "day", from: yesterday, to: yesterday },
  ];
  if (kyivWeekdayMon1(runKyivDay) === 1) {
    periods.push({ kind: "week", from: shiftKyivDay(yesterday, -6), to: yesterday });
  }
  if (runKyivDay.endsWith("-01")) {
    periods.push({ kind: "month", from: `${yesterday.slice(0, 7)}-01`, to: yesterday });
  }
  return periods;
}

function leadSourceKey(leadAgency: DirectClient["leadAgency"]): MarketingLeadSourceKey {
  if (leadAgency === "agency_2") return "agency_heart";
  if (leadAgency === "agency_1") return "agency_star";
  return "organic";
}

function toLeadLink(client: DirectClient): MarketingLeadLink & { sortKey: string } {
  return leadInstagramLink(client);
}

export function countStarredMarketing(
  clients: DirectClient[],
  from: string,
  to: string,
): Omit<MarketingReportData, "kind" | "from" | "to"> {
  let leads = 0;
  let consultationsCreated = 0;
  let consultationsAttended = 0;
  let consultationsNoShow = 0;
  let paidRecordsCreated = 0;
  const buckets = new Map<MarketingLeadSourceKey, Array<MarketingLeadLink & { sortKey: string }>>();
  for (const source of LEAD_SOURCES) buckets.set(source.key, []);

  for (const client of clients) {
    const firstContactDay = toKyivDay(client.firstContactDate);
    if (clientCountsTowardNewLeadsKpi(client) && inRange(firstContactDay, from, to)) {
      buckets.get(leadSourceKey(client.leadAgency))!.push(toLeadLink(client));
      if (client.leadAgency === "agency_1") leads += 1;
    }

    if (client.leadAgency !== "agency_1") continue;

    const consultCreatedDay = toKyivDay(client.consultationRecordCreatedAt);
    if (inRange(consultCreatedDay, from, to)) consultationsCreated += 1;

    const consultDay = toKyivDay(client.consultationBookingDate);
    if (inRange(consultDay, from, to)) {
      if (client.consultationAttended === true) consultationsAttended += 1;
      else if (client.consultationAttended === false && client.consultationCancelled !== true) {
        consultationsNoShow += 1;
      }
    }

    const paidCreatedDay = toKyivDay(client.paidServiceRecordCreatedAt);
    if (inRange(paidCreatedDay, from, to)) paidRecordsCreated += 1;
  }

  const leadSources: MarketingLeadSourceGroup[] = LEAD_SOURCES.map((source) => {
    const rows = buckets.get(source.key) ?? [];
    rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return {
      key: source.key,
      label: source.label,
      leads: rows.map(({ username, href }) => ({ username, href })),
    };
  });

  return {
    leads,
    leadSources,
    consultationsCreated,
    consultationsAttended,
    consultationsNoShow,
    paidRecordsCreated,
  };
}

export async function buildMarketingReport(
  kind: MarketingReportKind,
  from: string,
  to: string,
  clients?: DirectClient[],
): Promise<MarketingReportData> {
  const rows = clients ?? (await getAllDirectClients());
  return { kind, from, to, ...countStarredMarketing(rows, from, to) };
}

function periodTitle(data: MarketingReportData): string {
  if (data.kind === "week") {
    return `Тиждень ${formatKyivDayUa(data.from)}–${formatKyivDayUa(data.to)}`;
  }
  if (data.kind === "month") {
    const [y, m] = data.from.split("-");
    const monthName = new Intl.DateTimeFormat("uk-UA", {
      month: "long",
      timeZone: "Europe/Kyiv",
    }).format(new Date(Date.UTC(Number(y), Number(m) - 1, 15, 12)));
    return `Місяць ${monthName} ${y}`;
  }
  return `Вчора, ${formatKyivDayUa(data.from)}`;
}

export function formatMarketingReportTelegram(data: MarketingReportData): string {
  const kindLabel =
    data.kind === "week" ? "тиждень" : data.kind === "month" ? "місяць" : "день";
  const leadLines = ["Нові ліди"];
  for (const group of data.leadSources) {
    leadLines.push(`${group.label}: <b>${group.leads.length}</b>`);
    for (const lead of group.leads) leadLines.push(formatLeadInstagramTelegramLine(lead));
  }
  return [
    `<b>Маркетинг · зірочка · ${kindLabel}</b>`,
    periodTitle(data),
    "",
    ...leadLines,
    "",
    `Консультації створені: <b>${data.consultationsCreated}</b>`,
    `Прийшли: <b>${data.consultationsAttended}</b>`,
    `Не прийшли: <b>${data.consultationsNoShow}</b>`,
    `Платні записи створені: <b>${data.paidRecordsCreated}</b>`,
  ].join("\n");
}

/** Ділить HTML-текст по рядках, щоб кожен шматок вмістився в ліміт Telegram. */
export function splitMarketingTelegramMessages(text: string): string[] {
  return splitTelegramHtml(text);
}
