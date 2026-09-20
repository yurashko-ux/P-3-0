// Денні курси валют: фіксація при першому відкритті календаря на день Europe/Kyiv.
// Робочий курс = Math.round(rateBuy) + 1 (напр. 44.78 → 46).

import { prisma } from "@/lib/prisma";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { fetchMonobankCurrencySnapshot } from "@/lib/bank/monobank-currency";

export function workingFxFromBuy(rateBuy: number): number {
  const buy = Number(rateBuy);
  if (!(Number.isFinite(buy) && buy > 0)) return 0;
  return Math.round(buy) + 1;
}

export type DailyFxRow = {
  kyivDay: string;
  usdBuy: number;
  eurBuy: number;
  usdWorking: number;
  eurWorking: number;
  source: string;
  fetchedAt: string;
  fixed: boolean;
};

function toRow(row: {
  kyivDay: string;
  usdBuy: number;
  eurBuy: number;
  usdWorking: number;
  eurWorking: number;
  source: string;
  fetchedAt: Date;
}): DailyFxRow {
  return {
    kyivDay: row.kyivDay,
    usdBuy: row.usdBuy,
    eurBuy: row.eurBuy,
    usdWorking: row.usdWorking,
    eurWorking: row.eurWorking,
    source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
    fixed: true,
  };
}

/**
 * Повертає денний курс. Якщо запису немає і day = сьогодні — тягне Monobank rateBuy,
 * рахує робочий курс і зберігає (більше не змінює). Для минулих днів без запису — null.
 */
export async function getOrFixDailyFxRates(kyivDay: string): Promise<DailyFxRow | null> {
  const day = String(kyivDay || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("Некоректна дата kyivDay (YYYY-MM-DD)");
  }

  const existing = await prisma.dailyFxRate.findUnique({ where: { kyivDay: day } });
  if (existing) {
    console.log(
      `[daily-fx] Історія ${day}: USD ${existing.usdWorking} (buy ${existing.usdBuy}), EUR ${existing.eurWorking} (buy ${existing.eurBuy})`,
    );
    return toRow(existing);
  }

  const today = kyivCalendarTodayYmd();
  if (day !== today) {
    console.log(`[daily-fx] Немає історії для ${day} (минулий/майбутній день)`);
    return null;
  }

  const snap = await fetchMonobankCurrencySnapshot({ force: true });
  if (!snap?.usd?.rateBuy) {
    console.warn("[daily-fx] Monobank не повернув USD rateBuy — не фіксуємо день");
    return null;
  }
  const usdBuy = snap.usd.rateBuy;
  const eurBuy = snap.eur?.rateBuy && snap.eur.rateBuy > 0 ? snap.eur.rateBuy : usdBuy;
  const usdWorking = workingFxFromBuy(usdBuy);
  const eurWorking = workingFxFromBuy(eurBuy);
  if (!(usdWorking > 0) || !(eurWorking > 0)) {
    throw new Error("Некоректний робочий курс після округлення");
  }

  try {
    const created = await prisma.dailyFxRate.create({
      data: {
        kyivDay: day,
        usdBuy,
        eurBuy,
        usdWorking,
        eurWorking,
        source: "monobank",
        fetchedAt: new Date(snap.fetchedAt),
      },
    });
    console.log(
      `[daily-fx] ✅ Зафіксовано ${day}: USD buy=${usdBuy} → ${usdWorking}, EUR buy=${eurBuy} → ${eurWorking}`,
    );
    return toRow(created);
  } catch (err) {
    // Гонка: інший запит уже створив рядок
    const raced = await prisma.dailyFxRate.findUnique({ where: { kyivDay: day } });
    if (raced) return toRow(raced);
    throw err;
  }
}

export async function getDailyFxRates(kyivDay: string): Promise<DailyFxRow | null> {
  const day = String(kyivDay || "").trim();
  const row = await prisma.dailyFxRate.findUnique({ where: { kyivDay: day } });
  return row ? toRow(row) : null;
}
