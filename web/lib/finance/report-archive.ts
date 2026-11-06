// Архів блоків Фінзвіту за закриті місяці. Спершу живі дані; якщо Altegio не відповів — збережена копія.

import { Prisma } from "@prisma/client";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { prisma } from "@/lib/prisma";

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function saveBlock(key: string, block: string, value: unknown) {
  const payload = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  const existing = await prisma.financeReportArchive.findUnique({
    where: { month_block: { month: key, block } },
    select: { payload: true },
  });
  if (JSON.stringify(existing?.payload) === JSON.stringify(payload)) return;
  await prisma.financeReportArchive.upsert({
    where: { month_block: { month: key, block } },
    create: { month: key, block, payload },
    update: { payload, updatedAt: new Date() },
  });
}

export async function withFinanceReportArchive<T>(
  year: number,
  month: number,
  block: string,
  load: () => Promise<T>,
): Promise<T> {
  const key = monthKey(year, month);
  if (key >= kyivCalendarTodayYmd().slice(0, 7)) return load();
  try {
    const value = await load();
    await saveBlock(key, block, value).catch((err) => {
      console.warn(`[finance-report/archive] Не збережено ${key} ${block}:`, err);
    });
    return value;
  } catch (err) {
    const saved = await prisma.financeReportArchive.findUnique({
      where: { month_block: { month: key, block } },
      select: { payload: true },
    });
    if (!saved) throw err;
    console.warn(`[finance-report/archive] ${key} ${block}: Altegio недоступний — показуємо архів`);
    return saved.payload as T;
  }
}
