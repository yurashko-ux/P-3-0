// Увімкнені валюти складу. Базова валюта філії — не на цьому етапі.

import { prisma } from "@/lib/prisma";
import { CURRENCY_DIRECTORY, findCurrencyByCode } from "./currency-catalog";

export async function listSystemCurrencies() {
  const rows = await prisma.systemCurrency.findMany({ orderBy: { code: "asc" } });
  if (rows.length === 0) {
    await prisma.systemCurrency.createMany({
      data: [
        { code: "UAH", title: "Українська гривня", enabled: true },
        { code: "USD", title: "Долар США", enabled: true },
      ],
    });
    return prisma.systemCurrency.findMany({ orderBy: { code: "asc" } });
  }
  return rows;
}

export async function enableSystemCurrency(code: string) {
  const dir = findCurrencyByCode(code);
  if (!dir) {
    throw new Error("Цієї валюти немає в довіднику");
  }
  const row = await prisma.systemCurrency.upsert({
    where: { code: dir.code },
    create: { code: dir.code, title: dir.title, enabled: true },
    update: { title: dir.title, enabled: true },
  });
  console.log(`[warehouse/currencies] Увімкнено ${row.code}`);
  return row;
}

export async function disableSystemCurrency(code: string) {
  const key = String(code || "").trim().toUpperCase();
  if (key === "UAH") {
    throw new Error("Гривню не можна вимкнути");
  }
  const existing = await prisma.systemCurrency.findUnique({ where: { code: key } });
  if (!existing) return null;
  const row = await prisma.systemCurrency.update({
    where: { code: key },
    data: { enabled: false },
  });
  console.log(`[warehouse/currencies] Вимкнено ${row.code}`);
  return row;
}

export async function getEnabledCurrencyCodes(): Promise<string[]> {
  const rows = await listSystemCurrencies();
  const enabled = rows.filter((row) => row.enabled).map((row) => row.code);
  if (!enabled.includes("UAH")) enabled.unshift("UAH");
  return enabled;
}

export function currencyDirectory() {
  return CURRENCY_DIRECTORY;
}
