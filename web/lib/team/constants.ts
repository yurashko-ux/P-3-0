// Спільні константи довідника Команда (без Prisma — можна імпортувати в клієнт).

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
