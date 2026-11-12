import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  fetchChainClientDeposits,
  type AltegioClientDeposit,
} from "@/lib/altegio/client-deposits";
import type { DepositBalanceAccount } from "@/lib/altegio/deposit-balance-lookup";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Повний обхід deposits/company по клієнтах (clients/search без balance) може зайняти кілька хвилин. */
export const maxDuration = 300;

function mapDepositAccount(item: AltegioClientDeposit) {
  return {
    depositId: item.depositId,
    clientId: item.clientId,
    clientName: item.clientName,
    clientPhone: item.clientPhone,
    depositTypeTitle: item.depositTypeTitle,
    balance: item.balance,
  };
}

type LastTopup = NonNullable<DepositBalanceAccount["lastTopup"]>;
type CurrentRecord = NonNullable<DepositBalanceAccount["currentRecord"]>;

/**
 * Дата останнього поповнення й актуальний запис для клієнтів зі списку.
 * Два запити на всіх клієнтів разом (бюджет запитів до БД).
 */
async function loadTopupsAndRecords(clientIds: number[]): Promise<{
  topups: Map<number, LastTopup>;
  records: Map<number, CurrentRecord>;
}> {
  const topups = new Map<number, LastTopup>();
  const records = new Map<number, CurrentRecord>();
  if (clientIds.length === 0) return { topups, records };

  const idTexts = clientIds.map(String);
  const [topupRows, appointments] = await Promise.all([
    // Клієнт операції лежить лише в rawData.client.id; беремо останнє не видалене поповнення.
    prisma.$queryRaw<
      Array<{ cid: string; altegioId: number; kyivDay: string; accountTitle: string | null; n: number }>
    >`
      SELECT DISTINCT ON (cid) cid, "altegioId", "kyivDay", "accountTitle",
             (count(*) OVER (PARTITION BY cid))::int AS n
      FROM (
        SELECT "rawData"->'client'->>'id' AS cid, "altegioId", "kyivDay", "accountTitle", "operationDate"
        FROM altegio_finance_transactions
        WHERE "categoryTitle" = 'Client account top-up'
          AND "deletedInAltegio" = false
          AND "rawData"->'client'->>'id' = ANY(${idTexts}::text[])
      ) t
      ORDER BY cid, "operationDate" DESC
    `,
    prisma.salonAppointment.findMany({
      where: {
        altegioClientId: { in: clientIds },
        status: { not: "deleted" },
        altegioRecordId: { not: null },
      },
      select: { altegioClientId: true, altegioRecordId: true, datetime: true, kyivDay: true },
      orderBy: { datetime: "asc" },
    }),
  ]);

  for (const row of topupRows) {
    const clientId = Number(row.cid);
    if (!Number.isFinite(clientId)) continue;
    topups.set(clientId, {
      kyivDay: row.kyivDay,
      altegioTransactionId: Number(row.altegioId),
      accountTitle: row.accountTitle,
      count: row.n,
    });
  }

  // Як у картці Direct: найближчий майбутній запис; якщо його немає — останній минулий.
  const now = Date.now();
  for (const appt of appointments) {
    if (appt.altegioClientId == null || appt.altegioRecordId == null) continue;
    const isFuture = appt.datetime.getTime() >= now;
    const existing = records.get(appt.altegioClientId);
    // Рядки йдуть за часом: минулі перезаписуємо пізнішими, перший майбутній лишаємо.
    if (existing?.isFuture) continue;
    records.set(appt.altegioClientId, {
      altegioRecordId: appt.altegioRecordId,
      kyivDay: appt.kyivDay,
      isFuture,
    });
  }

  return { topups, records };
}

function sumPositiveBalance(accounts: ReturnType<typeof mapDepositAccount>[]): number {
  const sum = accounts
    .filter((item) => item.balance > 0)
    .reduce((total, item) => total + item.balance, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Повні залишки «Рахунки клієнта» Altegio для вкладки ЗАВДАТКИ.
 * Сума в шапці = сума рядків з balance > 0 (хто реально висить на депозиті).
 */
export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await fetchChainClientDeposits({
      balanceFrom: 0.01,
      limitPerPage: 100,
      maxPages: 80,
      maxClientsToScan: 5000,
    });

    const baseAccounts = result.deposits
      .filter((item) => item.balance > 0)
      .map(mapDepositAccount)
      .sort((a, b) => b.balance - a.balance || String(a.clientName || "").localeCompare(String(b.clientName || ""), "uk"));

    const totalBalance = sumPositiveBalance(baseAccounts);

    // Дата платежу й запис — довідкові: якщо БД не відповіла, список залишків усе одно показуємо.
    const clientIds = [
      ...new Set(baseAccounts.map((item) => item.clientId).filter((id): id is number => id != null)),
    ];
    let extra: Awaited<ReturnType<typeof loadTopupsAndRecords>> = { topups: new Map(), records: new Map() };
    try {
      extra = await loadTopupsAndRecords(clientIds);
    } catch (error) {
      console.error("[payment-reconciliation/incoming/deposit-tab-data] Не вдалося дочитати дати поповнень і записи:", error);
    }
    const accounts = baseAccounts.map((item) => ({
      ...item,
      lastTopup: item.clientId != null ? extra.topups.get(item.clientId) ?? null : null,
      currentRecord: item.clientId != null ? extra.records.get(item.clientId) ?? null : null,
    }));

    console.log("[payment-reconciliation/incoming/deposit-tab-data] Повні залишки", {
      source: result.source,
      accounts: accounts.length,
      totalBalance,
      pagesFetched: result.pagesFetched,
      clientsChecked: result.clientsChecked,
      clientsWithAccounts: result.clientsWithAccounts,
    });

    return NextResponse.json({
      ok: true,
      depositBalances: {
        totalBalance,
        source: result.source,
        accounts,
        pagesFetched: result.pagesFetched ?? null,
        clientsChecked: result.clientsChecked ?? null,
        clientsWithAccounts: result.clientsWithAccounts ?? null,
      },
    });
  } catch (error) {
    console.error("[payment-reconciliation/incoming/deposit-tab-data] Помилка:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Не вдалося завантажити баланси завдатків",
      },
      { status: 500 },
    );
  }
}
