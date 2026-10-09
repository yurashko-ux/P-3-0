// Касовка гривневої каси і нічний знімок усіх плиток.
// Знімок опівночі фіксує день, який щойно закінчився.

import { prisma } from "@/lib/prisma";
import { kyivCalendarTodayYmd, kyivCalendarYesterdayYmd } from "@/lib/direct-kyiv-today";
import { listCashBalances, type CashBalanceTile } from "@/lib/finance/cash-balances";
import {
  cashCountTotal,
  noteDenoms,
  parseCashCountLines,
  type CashCountCurrency,
  type CashCountLine,
} from "@/lib/finance/cash-denominations";
import { postCashMovementsIfMatched } from "@/lib/finance/cash-posting";

export type CashSnapshotLine = {
  accountId: number;
  title: string;
  cash: boolean;
  currency: CashBalanceTile["currency"];
  balanceUah: number | null;
  balanceFx: number | null;
  openingPending: boolean;
  hasBank: boolean;
  countedUah: number | null;
};

export type CashDaySnapshotView = {
  kyivDay: string;
  capturedAt: string;
  lines: CashSnapshotLine[];
};

function isCountableCashTile(tile: CashBalanceTile): boolean {
  return tile.cash && !tile.openingPending;
}

function bookAmount(tile: CashBalanceTile): number | null {
  if (tile.currency === "UAH") return tile.balanceUah;
  return tile.balanceFx;
}

export async function latestUahCountsForDay(
  kyivDay: string,
  accountIds: number[],
): Promise<Map<number, number>> {
  const latest = new Map<number, number>();
  if (accountIds.length === 0) return latest;
  const rows = await prisma.cashTillCount.findMany({
    where: { kyivDay, accountId: { in: accountIds } },
    orderBy: { createdAt: "desc" },
    select: { accountId: true, countedUah: true },
  });
  for (const row of rows) {
    if (!latest.has(row.accountId)) latest.set(row.accountId, row.countedUah);
  }
  return latest;
}

export async function saveCashTillCount(input: {
  accountId: number;
  lines: unknown;
  createdBy?: string | null;
}): Promise<{ countedUah: number; kyivDay: string }> {
  const accountId = Number(input.accountId) || 0;
  if (!(accountId > 0)) throw new Error("Немає id каси");
  const tiles = await listCashBalances();
  const tile = tiles.find((item) => item.id === accountId);
  if (!tile || !isCountableCashTile(tile)) throw new Error("Касовка лише для готівкової каси з початковим залишком");
  const currency = tile.currency as CashCountCurrency;
  const lines = parseCashCountLines(input.lines, noteDenoms(currency));
  const countedUah = cashCountTotal(lines);
  const book = bookAmount(tile);
  if (book == null) throw new Error("Немає балансу каси");
  const kyivDay = kyivCalendarTodayYmd();
  const saved = await prisma.cashTillCount.create({
    data: {
      kyivDay,
      accountId,
      accountTitle: tile.title,
      countedUah,
      currency,
      lines: lines as CashCountLine[],
      createdBy: input.createdBy || null,
    },
  });
  const posting = await postCashMovementsIfMatched({
    countId: saved.id,
    accountId,
    accountTitle: tile.title,
    currency: tile.currency,
    counted: countedUah,
    book,
  });
  console.log(
    `[finance/cash-count] ${kyivDay} каса ${accountId} «${tile.title}»: факт ${countedUah} ${currency}, документи ${book}${posting.matched ? `, проведено ${posting.posted}` : ""}`,
  );
  return { countedUah, kyivDay };
}

function snapshotLine(tile: CashBalanceTile, countedUah: number | null): CashSnapshotLine {
  return {
    accountId: tile.id,
    title: tile.title,
    cash: tile.cash,
    currency: tile.currency,
    balanceUah: tile.balanceUah,
    balanceFx: tile.balanceFx,
    openingPending: tile.openingPending,
    hasBank: tile.hasBank,
    countedUah: isCountableCashTile(tile) ? countedUah : null,
  };
}

export async function captureCashDaySnapshot(kyivDay?: string): Promise<{ kyivDay: string; created: boolean }> {
  const day = kyivDay && /^\d{4}-\d{2}-\d{2}$/.test(kyivDay) ? kyivDay : kyivCalendarYesterdayYmd();
  const existing = await prisma.cashDaySnapshot.findUnique({ where: { kyivDay: day } });
  if (existing) {
    console.log(`[finance/cash-snapshot] Знімок ${day} уже є`);
    return { kyivDay: day, created: false };
  }
  const tiles = await listCashBalances();
  const cashIds = tiles.filter(isCountableCashTile).map((tile) => tile.id);
  const counts = await latestUahCountsForDay(day, cashIds);
  const lines = tiles.map((tile) => snapshotLine(tile, counts.get(tile.id) ?? null));
  await prisma.cashDaySnapshot.create({
    data: { kyivDay: day, lines },
  });
  console.log(`[finance/cash-snapshot] Записано знімок ${day}: ${lines.length} рахунків`);
  return { kyivDay: day, created: true };
}

function asSnapshotLines(raw: unknown): CashSnapshotLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && typeof row === "object") as CashSnapshotLine[];
}

export async function listCashDaySnapshots(limit = 60): Promise<CashDaySnapshotView[]> {
  const take = Math.min(Math.max(limit, 1), 120);
  const rows = await prisma.cashDaySnapshot.findMany({
    orderBy: { kyivDay: "desc" },
    take,
  });
  return rows.map((row) => ({
    kyivDay: row.kyivDay,
    capturedAt: row.capturedAt.toISOString(),
    lines: asSnapshotLines(row.lines),
  }));
}
