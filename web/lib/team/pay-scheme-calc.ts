// Розрахунок нарахування ЗП за схемою (довідник → майбутнє автонарахування за період).
// «Оборот» = весь оборот майстра: послуги + товари (як payroll total_sum / masters-stats МТД).
// «Продаж волосся» = лише товари, класифіковані як волосся (не всі goods).

import type { TeamPayKind } from "@/lib/team/constants";

/** Бази періоду для особи (грн). Невикористані поля можна лишити 0. */
export type PayPeriodBases = {
  /** Сума послуг (services_sum). */
  servicesUah: number;
  /** Усі товари / goods_sales_sum (без розділення на волосся). */
  goodsUah: number;
  /** Лише продаж волосся (підмножина товарів). */
  hairSalesUah: number;
  /** Дні роботи (для fixed_day). */
  workDays?: number;
};

export type PaySchemeLike = {
  kind: string;
  params?: Record<string, unknown> | null;
};

export type PayAccrualResult = {
  amountUah: number;
  /** Короткий опис бази / формули для логів і UI. */
  breakdown: string;
};

function num(params: Record<string, unknown> | null | undefined, key: string): number {
  const v = params?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Весь оборот = послуги + усі товари (узгоджено з Altegio payroll total_sum). */
export function fullTurnoverUah(bases: PayPeriodBases): number {
  return Math.max(0, bases.servicesUah) + Math.max(0, bases.goodsUah);
}

/**
 * Нарахування за схемою.
 * Параметр `pctHair` у старих схемах ігнорується (застарілий вторинний % волосся на pct_services/mix).
 */
export function calculatePayAccrual(scheme: PaySchemeLike, bases: PayPeriodBases): PayAccrualResult {
  const kind = scheme.kind as TeamPayKind;
  const params = (scheme.params || {}) as Record<string, unknown>;
  const services = Math.max(0, bases.servicesUah);
  const goods = Math.max(0, bases.goodsUah);
  const hair = Math.max(0, bases.hairSalesUah);
  const turnover = fullTurnoverUah(bases);
  const days = Math.max(0, bases.workDays ?? 0);

  switch (kind) {
    case "fixed_month": {
      const fixed = num(params, "fixedUah");
      return { amountUah: fixed, breakdown: `оклад ${fixed} ₴` };
    }
    case "fixed_day": {
      const fixed = num(params, "fixedUah");
      const amount = fixed * days;
      return { amountUah: amount, breakdown: `${fixed} ₴ × ${days} дн.` };
    }
    case "pct_services": {
      const pct = num(params, "pctServices");
      const amount = (services * pct) / 100;
      return { amountUah: amount, breakdown: `${pct}% від послуг ${services} ₴` };
    }
    case "pct_turnover": {
      const pct = num(params, "pctTurnover");
      const amount = (turnover * pct) / 100;
      return {
        amountUah: amount,
        breakdown: `${pct}% від обороту ${turnover} ₴ (послуги ${services} + товари ${goods})`,
      };
    }
    case "pct_hair": {
      const pct = num(params, "pctHairSales");
      const amount = (hair * pct) / 100;
      return { amountUah: amount, breakdown: `${pct}% від продажу волосся ${hair} ₴` };
    }
    case "pct_goods": {
      const pct = num(params, "pctGoods");
      const amount = (goods * pct) / 100;
      return { amountUah: amount, breakdown: `${pct}% від товарів ${goods} ₴` };
    }
    case "mix": {
      const fixed = num(params, "fixedUah");
      const pct = num(params, "pctServices");
      const fromPct = (services * pct) / 100;
      const amount = fixed + fromPct;
      return {
        amountUah: amount,
        breakdown: `оклад ${fixed} ₴ + ${pct}% послуг (= ${fromPct} ₴)`,
      };
    }
    case "min_guarantee": {
      const fixed = num(params, "fixedUah");
      const pct = num(params, "pctServices");
      const minUah = num(params, "minUah");
      const fromPct = (services * pct) / 100;
      const raw = fixed + fromPct;
      const amount = Math.max(raw, minUah);
      return {
        amountUah: amount,
        breakdown: `max(оклад ${fixed} + ${pct}% послуг = ${raw} ₴, мін. ${minUah} ₴)`,
      };
    }
    default:
      console.warn(`[team/pay-scheme-calc] Невідомий kind=${scheme.kind}`);
      return { amountUah: 0, breakdown: `невідомий тип ${scheme.kind}` };
  }
}

/** Прибраємо застарілий pctHair зі збережених params (не чіпаємо pctHairSales). */
export function sanitizeSchemeParams(
  kind: string,
  params: Record<string, unknown> | null | undefined,
): Record<string, number> {
  const src = params || {};
  const out: Record<string, number> = {};
  const take = (key: string) => {
    const v = num(src, key);
    if (v !== 0 || src[key] != null) out[key] = v;
  };
  switch (kind) {
    case "fixed_month":
    case "fixed_day":
      take("fixedUah");
      break;
    case "pct_services":
      take("pctServices");
      break;
    case "pct_turnover":
      take("pctTurnover");
      break;
    case "pct_hair":
      take("pctHairSales");
      break;
    case "pct_goods":
      take("pctGoods");
      break;
    case "mix":
      take("fixedUah");
      take("pctServices");
      break;
    case "min_guarantee":
      take("fixedUah");
      take("pctServices");
      take("minUah");
      break;
    default:
      break;
  }
  return out;
}
