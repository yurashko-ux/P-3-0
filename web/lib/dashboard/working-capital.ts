// Обігові кошти салону: де лежать гроші зараз і щоденні знімки для графіка.
// База — долар за робочим курсом дня (monobank). Матеріали не рахуємо: це розхід, а не обіг.
// Запитів до БД: залишки кас (як у блоці «Залишки в касах») + 1 склад + 1 курс; знімок — ще 1 upsert.

import { prisma } from "@/lib/prisma";
import { getOrFixDailyFxRates } from "@/lib/fx/daily-rates";
import { loadDashboardCash } from "./cash";
import { kyivToday } from "./period";
import type { DashboardWorkingCapital, WorkingCapitalParts, WorkingCapitalPoint } from "./types";

type StockSqlRow = { hair_usd: number; hair_uah: number; goods_uah: number };

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Сума в доларах за курсами дня. */
export function workingCapitalUsd(parts: WorkingCapitalParts, usdRate: number, eurRate: number) {
  const uah = parts.goodsUah + parts.cashUah + parts.bankUah;
  const eur = parts.cashEur + parts.bankEur;
  const totalUsd = parts.hairUsd + parts.cashUsd + parts.bankUsd + (uah + eur * eurRate) / usdRate;
  return { totalUsd: round2(totalUsd), ownUsd: round2(totalUsd - parts.depositsUah / usdRate) };
}

async function loadRates(today: string): Promise<{ kyivDay: string; usd: number; eur: number } | null> {
  const fixed = await getOrFixDailyFxRates(today).catch((err) => {
    console.warn("[working-capital] Не вдалося зафіксувати курс дня:", err);
    return null;
  });
  if (fixed) return { kyivDay: fixed.kyivDay, usd: fixed.usdWorking, eur: fixed.eurWorking };
  const latest = await prisma.dailyFxRate.findFirst({
    where: { kyivDay: { lte: today } },
    orderBy: { kyivDay: "desc" },
    select: { kyivDay: true, usdWorking: true, eurWorking: true },
  });
  return latest ? { kyivDay: latest.kyivDay, usd: latest.usdWorking, eur: latest.eurWorking } : null;
}

export async function computeWorkingCapital(): Promise<
  (WorkingCapitalPoint & { eurRate: number; parts: WorkingCapitalParts }) | null
> {
  const startedAt = Date.now();
  const today = kyivToday();
  const [cash, stock, rates] = await Promise.all([
    loadDashboardCash(),
    // Лише склади фінзвіту: «Витратні матеріали» туди не входять.
    prisma.$queryRaw<StockSqlRow[]>`
      SELECT
        coalesce(sum(st.quantity * p."costUsd")
          FILTER (WHERE p."isHair" AND p."costUsd" > 0), 0)::float AS hair_usd,
        coalesce(sum(st.quantity * (CASE WHEN st."costPerUnit" > 0 THEN st."costPerUnit" ELSE p."costPerUnit" END))
          FILTER (WHERE p."isHair" AND NOT p."costUsd" > 0), 0)::float AS hair_uah,
        coalesce(sum(st.quantity * (CASE WHEN st."costPerUnit" > 0 THEN st."costPerUnit" ELSE p."costPerUnit" END))
          FILTER (WHERE NOT p."isHair"), 0)::float AS goods_uah
      FROM warehouse_stocks st
      JOIN warehouse_storages s ON s.id = st."storageId"
      JOIN warehouse_products p ON p.id = st."productId"
      WHERE s."isActive" AND s."includeInFinanceReport" AND st.quantity > 0
    `,
    loadRates(today),
  ]);

  if (!rates || !(rates.usd > 0)) {
    console.warn("[working-capital] Немає робочого курсу долара — обігові кошти не рахуємо");
    return null;
  }
  const eurRate = rates.eur > 0 ? rates.eur : rates.usd;
  const s = stock[0] || { hair_usd: 0, hair_uah: 0, goods_uah: 0 };

  const parts: WorkingCapitalParts = {
    // Волосся без доларової ціни переводимо за курсом дня, доки прийомка не в $.
    hairUsd: round2(s.hair_usd + s.hair_uah / rates.usd),
    goodsUah: round2(s.goods_uah),
    cashUah: 0,
    cashUsd: 0,
    cashEur: 0,
    bankUah: 0,
    bankUsd: 0,
    bankEur: 0,
    depositsUah: cash.deposits.balance,
  };
  for (const account of cash.accounts) {
    if (account.balance == null) continue;
    const key = `${account.cash ? "cash" : "bank"}${account.currency === "UAH" ? "Uah" : account.currency === "USD" ? "Usd" : "Eur"}` as const;
    parts[key] = round2(parts[key] + account.balance);
  }

  const totals = workingCapitalUsd(parts, rates.usd, eurRate);
  console.log(
    `[working-capital] ${today}: усього ${totals.totalUsd} $, власні ${totals.ownUsd} $ (курс ${rates.usd} від ${rates.kyivDay}), ${Date.now() - startedAt} мс`,
  );
  return { kyivDay: today, usdRate: rates.usd, eurRate, parts, ...totals };
}

/** Знімки для графіка. Таблиці ще немає (міграція не застосована) — порожня історія, а не помилка. */
export async function loadWorkingCapitalHistory(): Promise<WorkingCapitalPoint[]> {
  try {
    return await prisma.workingCapitalSnapshot.findMany({
      orderBy: { kyivDay: "asc" },
      take: 1000,
      select: { kyivDay: true, totalUsd: true, ownUsd: true, usdRate: true },
    });
  } catch (err) {
    console.warn("[working-capital] Знімки недоступні:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function loadDashboardWorkingCapital(): Promise<DashboardWorkingCapital> {
  const [now, history] = await Promise.all([computeWorkingCapital(), loadWorkingCapitalHistory()]);
  return { ok: true, now, history };
}

/** Знімок дня: повторний запуск того ж дня перезаписує рядок. */
export async function captureWorkingCapitalSnapshot() {
  const now = await computeWorkingCapital();
  if (!now) return { ok: false as const, reason: "no_fx_rate" };
  const data = {
    usdRate: now.usdRate,
    eurRate: now.eurRate,
    ...now.parts,
    totalUsd: now.totalUsd,
    ownUsd: now.ownUsd,
  };
  await prisma.workingCapitalSnapshot.upsert({
    where: { kyivDay: now.kyivDay },
    create: { kyivDay: now.kyivDay, ...data },
    update: data,
  });
  console.log(`[working-capital] ✅ Знімок ${now.kyivDay}: ${now.totalUsd} $`);
  return { ok: true as const, kyivDay: now.kyivDay, totalUsd: now.totalUsd, ownUsd: now.ownUsd };
}
