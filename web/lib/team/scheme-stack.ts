// Кілька схем однієї людини додаються. Колізія — дві схеми б'ють в одну базу.
// Попередження не блокує збереження: обидві суми все одно входять у підсумок.
// «% від обороту» і «% від товарів» — різні бази, це не колізія.

import type { TeamPayKind } from "@/lib/team/constants";
import { calculatePayAccrual, type PayPeriodBases, type PaySchemeLike } from "@/lib/team/pay-scheme-calc";

export type SchemeComponent =
  | "fixed_month"
  | "fixed_day"
  | "fixed_amount"
  | "pct_services"
  | "pct_turnover"
  | "pct_hair"
  | "pct_goods";

export const SCHEME_COMPONENT_LABELS: Record<SchemeComponent, string> = {
  fixed_month: "оклад за місяць",
  fixed_day: "ставка за день",
  fixed_amount: "фіксована сума",
  pct_services: "% від послуг",
  pct_turnover: "% від обороту",
  pct_hair: "% від волосся",
  pct_goods: "% від товарів",
};

export type SchemeRef = PaySchemeLike & {
  id: string;
  title: string;
  kind: string;
};

export type SchemeCollision = {
  component: SchemeComponent;
  label: string;
  schemes: Array<{ id: string; title: string }>;
};

/** З яких баз складається тип схеми. Мікс = оклад + % послуг. */
export function componentsOfKind(kind: string): SchemeComponent[] {
  switch (kind as TeamPayKind) {
    case "fixed_month":
      return ["fixed_month"];
    case "fixed_day":
      return ["fixed_day"];
    case "fixed_amount":
      return ["fixed_amount"];
    case "pct_services":
      return ["pct_services"];
    case "pct_turnover":
      return ["pct_turnover"];
    case "pct_hair":
      return ["pct_hair"];
    case "pct_goods":
      return ["pct_goods"];
    case "mix":
    case "min_guarantee":
      return ["fixed_month", "pct_services"];
    default:
      return [];
  }
}

export function findSchemeCollisions(schemes: SchemeRef[]): SchemeCollision[] {
  const byComponent = new Map<SchemeComponent, SchemeRef[]>();
  for (const scheme of schemes) {
    for (const component of componentsOfKind(scheme.kind)) {
      const list = byComponent.get(component) || [];
      if (!list.some((s) => s.id === scheme.id)) list.push(scheme);
      byComponent.set(component, list);
    }
  }
  const collisions: SchemeCollision[] = [];
  for (const [component, list] of byComponent) {
    if (list.length < 2) continue;
    collisions.push({
      component,
      label: SCHEME_COMPONENT_LABELS[component],
      schemes: list.map((s) => ({ id: s.id, title: s.title })),
    });
  }
  return collisions;
}

export function collisionWarningText(collisions: SchemeCollision[]): string | null {
  if (collisions.length === 0) return null;
  const parts = collisions.map((c) => {
    const names = c.schemes.map((s) => `«${s.title}»`).join(" і ");
    return `${names} разом рахують ${c.label}`;
  });
  return `Колізія: ${parts.join("; ")}. Схеми лишаються і їхні суми додаються.`;
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export type StackedAccrualPart = {
  schemeId: string;
  title: string;
  kind: string;
  amountUah: number;
  breakdown: string;
};

/** Сума нарахувань усіх схем на одних базах прикладу. */
export function stackPayAccrual(schemes: SchemeRef[], bases: PayPeriodBases): {
  parts: StackedAccrualPart[];
  totalUah: number;
  collisions: SchemeCollision[];
} {
  const parts = schemes.map((scheme) => {
    const accrued = calculatePayAccrual(scheme, bases);
    return {
      schemeId: scheme.id,
      title: scheme.title,
      kind: scheme.kind,
      amountUah: money(accrued.amountUah),
      breakdown: accrued.breakdown,
    };
  });
  const totalUah = money(parts.reduce((sum, part) => sum + part.amountUah, 0));
  return { parts, totalUah, collisions: findSchemeCollisions(schemes) };
}
