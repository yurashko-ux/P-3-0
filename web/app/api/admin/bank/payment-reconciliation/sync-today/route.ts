import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { syncAltegioFinanceTransactions } from "@/lib/altegio/finance-transactions-sync";
import { syncBankOutgoingStatementsForReconciliation } from "@/lib/bank/payment-reconciliation-sync";
import { reconcileBankAltegioPayments } from "@/lib/bank/altegio-payment-reconcile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function kyivYmd(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function kyivDayUtcRange(ymd: string): { from: string; to: string } {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMidday);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 12);
  const offsetHours = hour - 12;
  const startUtc = new Date(Date.UTC(year, month - 1, day, 0 - offsetHours, 0, 0, 0));
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { from: startUtc.toISOString(), to: endUtc.toISOString() };
}

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day)
      ? body.day
      : kyivYmd();
    const range = kyivDayUtcRange(day);

    const bank = await syncBankOutgoingStatementsForReconciliation({
      from: range.from,
      to: range.to,
      maxAccounts: null,
      accountType: "fop",
      requireAltegioAccount: false,
    });

    const altegio = await syncAltegioFinanceTransactions({
      dateFrom: day,
      dateTo: day,
      syncPurposes: true,
    });

    const reconcile = await reconcileBankAltegioPayments({
      from: range.from,
      to: range.to,
      limit: 1000,
    });

    const cashlessAltegioOutgoing = await (prisma as any).altegioFinanceTransaction.count({
      where: {
        kyivDay: day,
        direction: "out",
        deletedInAltegio: false,
        accountId: {
          in: await prisma.bankAccount
            .findMany({
              where: {
                type: "fop",
                currencyCode: 980,
                altegioAccountId: { not: null },
              },
              select: { altegioAccountId: true },
            })
            .then((accounts) =>
              accounts
                .map((account) => account.altegioAccountId)
                .filter((value): value is string => Boolean(value)),
            ),
        },
      },
    });

    return NextResponse.json({
      ok: true,
      day,
      range,
      bank,
      altegio,
      reconcile,
      cashlessAltegioOutgoing,
    });
  } catch (error) {
    console.error("[payment-reconciliation/sync-today] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка синхронізації сьогоднішніх платежів" },
      { status: 500 },
    );
  }
}
