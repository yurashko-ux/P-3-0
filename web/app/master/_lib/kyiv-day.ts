// Легкі, самодостатні утиліти дня Europe/Kyiv для /master — без важких серверних імпортів,
// щоб не тягнути зайве в клієнтський бандл Mini App.

const KYIV_TZ = "Europe/Kyiv";

export function kyivYmdFromDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

export function kyivTodayYmd(): string {
  return kyivYmdFromDate(new Date());
}

/** Крок на +N/-N календарних днів у Kyiv (стійко до переходу через північ/DST). */
export function shiftKyivDay(ymd: string, deltaDays: number): string {
  const anchor = new Date(`${ymd}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  return kyivYmdFromDate(anchor);
}

const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_SHORT_UA = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

function kyivWeekdayIndex(ymd: string): number {
  const anchor = new Date(`${ymd}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, weekday: "short" }).format(anchor);
  return Math.max(0, WEEKDAY_ORDER.indexOf(label));
}

/** Пн..Нд (7 днів) того тижня, що містить ymd. */
export function kyivWeekDays(ymd: string): string[] {
  const monday = shiftKyivDay(ymd, -kyivWeekdayIndex(ymd));
  return Array.from({ length: 7 }, (_, i) => shiftKyivDay(monday, i));
}

export function weekdayShortLabel(ymd: string): string {
  return WEEKDAY_SHORT_UA[kyivWeekdayIndex(ymd)] ?? "";
}

export function dayOfMonth(ymd: string): string {
  const [, , d] = ymd.split("-");
  return d ? String(Number(d)) : ymd;
}

export function formatKyivDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "UTC" });
}

export function formatKyivTimeRange(iso: string, seanceLengthSec: number): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: KYIV_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const startMin = Number(hour) * 60 + Number(minute);
  const endMin = startMin + Math.max(0, Math.round((seanceLengthSec || 0) / 60));
  const fmt = (totalMin: number) =>
    `${String(Math.floor(totalMin / 60) % 24).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
  return `${fmt(startMin)}–${fmt(endMin)}`;
}

export function formatDurationShort(seanceLengthSec: number): string {
  const m = Math.max(0, Math.round((seanceLengthSec || 0) / 60));
  if (m < 60) return `${m} хв`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} год` : `${h} год ${rest} хв`;
}
