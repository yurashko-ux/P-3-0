// Спільні константи довідника Команда (без Prisma — можна імпортувати в клієнт).

/** Стартові коди посад (насіннєві записи TeamPosition). */
export const TEAM_POSITION_SEED = [
  { code: "master", name: "Майстер", order: 10 },
  { code: "assistant", name: "Асистент", order: 20 },
  { code: "admin", name: "Адміністратор", order: 30 },
  { code: "direct", name: "Direct", order: 40 },
  { code: "other", name: "Інше", order: 50 },
] as const;

/** @deprecated використовуйте довідник TeamPosition; лишається для імпорту Altegio → code */
export const TEAM_SALON_ROLES = ["master", "assistant", "admin", "direct", "other"] as const;
export type TeamSalonRole = (typeof TEAM_SALON_ROLES)[number];

export const TEAM_PAY_KINDS = [
  "fixed_month",
  "fixed_day",
  "fixed_amount",
  "pct_services",
  "pct_turnover",
  "pct_hair",
  "pct_goods",
  "mix",
  "min_guarantee",
] as const;
export type TeamPayKind = (typeof TEAM_PAY_KINDS)[number];

export const TEAM_PAY_KIND_LABELS: Record<TeamPayKind, string> = {
  fixed_month: "Оклад (місяць)",
  fixed_day: "Оклад (день)",
  fixed_amount: "Фіксована сума",
  pct_services: "% від послуг",
  pct_turnover: "% від обороту",
  pct_hair: "% від продажу волосся",
  pct_goods: "% від товарів",
  mix: "Мікс (оклад + %)",
  min_guarantee: "Мін. гарантія",
};

export const TYPICAL_SCHEMES: Array<{ title: string; kind: TeamPayKind; params: Record<string, number> }> = [
  { title: "Оклад (місяць)", kind: "fixed_month", params: { fixedUah: 20000 } },
  { title: "Фіксована сума", kind: "fixed_amount", params: { fixedAmount: 15000 } },
  { title: "40% від послуг", kind: "pct_services", params: { pctServices: 40 } },
  { title: "30% від обороту", kind: "pct_turnover", params: { pctTurnover: 30 } },
  { title: "20% від продажу волосся", kind: "pct_hair", params: { pctHairSales: 20 } },
  { title: "Оклад + % послуг", kind: "mix", params: { fixedUah: 5000, pctServices: 30 } },
];

/** Сьогоднішній день Europe/Kyiv у форматі YYYY-MM-DD. */
export function getTodayKyivYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
