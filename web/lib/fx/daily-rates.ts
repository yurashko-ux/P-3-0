// Денні курси валют: фіксація при першому відкритті календаря на день Europe/Kyiv.
// Робочий курс = Math.ceil(rateSell) + 1 (напр. 44.43 → ceil 45 → +1 = 46).

import { prisma } from "@/lib/prisma";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { fetchMonobankCurrencySnapshot } from "@/lib/bank/monobank-currency";

export function workingFxFromSell(rateSell: number): number {
  const sell = Number(rateSell);
  if (!(Number.isFinite(sell) && sell > 0)) return 0;
  return Math.ceil(sell) + 1;
}

export type DailyFxRow = {
  kyivDay: string;
  usdSell: number;
  eurSell: number;
  usdWorking: number;
  eurWorking: number;
  source: string;
  fetchedAt: string;
  fixed: boolean;
};

function toRow(row: {
  kyivDay: string;
  usdSell: number;
  eurSell: number;
  usdWorking: number;
  eurWorking: number;
  source: string;
  fetchedAt: Date;
}): DailyFxRow {
  return {
    kyivDay: row.kyivDay,
    usdSell: row.usdSell,
    eurSell: row.eurSell,
    usdWorking: row.usdWorking,
    eurWorking: row.eurWorking,
    source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
    fixed: true,
  };
}

/**
 * Повертає денний курс. Якщо запису немає і day = сьогодні — тягне Monobank rateSell,
 * рахує робочий курс (ceil+1) і зберігає (більше не змінює). Для минулих днів без запису — null.
 */
export async function getOrFixDailyFxRates(kyivDay: string): Promise<DailyFxRow | null> {
  const day = String(kyivDay || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("Некоректна дата kyivDay (YYYY-MM-DD)");
  }

  const existing = await prisma.dailyFxRate.findUnique({ where: { kyivDay: day } });
  if (existing) {
    console.log(
      `[daily-fx] Історія ${day}: USD ${existing.usdWorking} (sell ${existing.usdSell}), EUR ${existing.eurWorking} (sell ${existing.eurSell})`,
    );
    return toRow(existing);
  }

  const today = kyivCalendarTodayYmd();
  if (day !== today) {
    console.log(`[daily-fx] Немає історії для ${day} (минулий/майбутній день)`);
    return null;
  }

  const snap = await fetchMonobankCurrencySnapshot({ force: true });
  if (!snap?.usd?.rateSell) {
    console.warn("[daily-fx] Monobank не повернув USD rateSell — не фіксуємо день");
    return null;
  }
  const usdSell = snap.usd.rateSell;
  const eurSell =
    snap.eur?.rateSell && snap.eur.rateSell > 0 ? snap.eur.rateSell : usdSell;
  const usdWorking = workingFxFromSell(usdSell);
  const eurWorking = workingFxFromSell(eurSell);
  if (!(usdWorking > 0) || !(eurWorking > 0)) {
    throw new Error("Некоректний робочий курс після округлення вгору");
  }

  try {
    const created = await prisma.dailyFxRate.create({
      data: {
        kyivDay: day,
        usdSell,
        eurSell,
        usdWorking,
        eurWorking,
        source: "monobank",
        fetchedAt: new Date(snap.fetchedAt),
      },
    });
    console.log(
      `[daily-fx] ✅ Зафіксовано ${day}: USD sell=${usdSell} → ${usdWorking}, EUR sell=${eurSell} → ${eurWorking}`,
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
