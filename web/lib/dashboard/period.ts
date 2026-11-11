// Дати дашборду: календарні дні Europe/Kyiv у форматі YYYY-MM-DD. Чисті функції — і для сервера, і для сторінки.

const KYIV_TZ = "Europe/Kyiv";

export const MONTH_TITLES = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];

/** Найдовший період, який дозволяємо за один запит (щоб не тягнути з БД пів року записів). */
export const MAX_PERIOD_DAYS = 93;

export function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function kyivDayOf(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function kyivToday(): string {
  return kyivDayOf(new Date());
}

function toUtcNoon(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(ymd: string, delta: number): string {
  const date = toUtcNoon(ymd);
  date.setUTCDate(date.getUTCDate() + delta);
  return fromUtc(date);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcNoon(to).getTime() - toUtcNoon(from).getTime()) / 86_400_000) + 1;
}

/** Понеділок тижня, до якого належить день. */
export function weekStart(ymd: string): string {
  const weekday = (toUtcNoon(ymd).getUTCDay() + 6) % 7;
  return addDays(ymd, -weekday);
}

/** Межі місяця, зсунутого на delta від місяця дня ymd. */
export function monthRange(ymd: string, delta = 0): { from: string; to: string; year: number; month: number } {
  const [y, m] = ymd.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1, 12));
  const last = new Date(Date.UTC(y, m + delta, 0, 12));
  return { from: fromUtc(first), to: fromUtc(last), year: first.getUTCFullYear(), month: first.getUTCMonth() + 1 };
}

/** Початок календарного дня Kyiv у UTC (для полів DateTime: createdAt, receivedAt, startTime). */
export function kyivDayStartUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Зсув Kyiv від UTC на цю дату: +2 взимку, +3 влітку.
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: KYIV_TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(guess)),
  );
  return new Date(guess - hour * 3_600_000);
}

export type PeriodPreset = { key: string; label: string; from: string; to: string; future?: boolean };

/** Кнопки біля календаря. Три майбутні місяці підписані назвою місяця і зсуваються самі. */
export function buildPresets(today: string): PeriodPreset[] {
  const yesterday = addDays(today, -1);
  const thisWeek = weekStart(today);
  const thisMonth = monthRange(today, 0);
  const lastMonth = monthRange(today, -1);
  const presets: PeriodPreset[] = [
    { key: "today", label: "Сьогодні", from: today, to: today },
    { key: "yesterday", label: "Вчора", from: yesterday, to: yesterday },
    { key: "week", label: "Цей тиждень", from: thisWeek, to: addDays(thisWeek, 6) },
    { key: "last-week", label: "Минулий тиждень", from: addDays(thisWeek, -7), to: addDays(thisWeek, -1) },
    { key: "month", label: "Цей місяць", from: thisMonth.from, to: thisMonth.to },
    { key: "last-month", label: "Минулий місяць", from: lastMonth.from, to: lastMonth.to },
  ];
  for (let delta = 1; delta <= 3; delta++) {
    const range = monthRange(today, delta);
    presets.push({
      key: `next-${delta}`,
      label: MONTH_TITLES[range.month - 1],
      from: range.from,
      to: range.to,
      future: true,
    });
  }
  return presets;
}

export function formatDayShort(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

export function formatPeriod(from: string, to: string): string {
  return from === to ? formatDayShort(from) : `${formatDayShort(from)} — ${formatDayShort(to)}`;
}
