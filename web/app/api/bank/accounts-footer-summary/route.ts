// GET: зведення для футера сторінки Банк — баланси рахунків та залишок річного ліміту (UAH)

import { NextResponse } from "next/server";
import { prisma, getDbHostForLog } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { computeYtdIncomingKopThrough } from "@/lib/bank/fop-turnover";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UAH = 980;

function last4(s: string | null): string {
  if (!s) return "—";
  const digits = s.replace(/\D/g, "");
  return digits.slice(-4) || "—";
}

function isMissingFopOrOpeningColumns(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return (
    m.includes("altegioOpeningBalanceManual") ||
    m.includes("altegioOpeningBalanceDate") ||
    m.includes("altegioMonthlyTurnoverManual") ||
    m.includes("fopAnnualTurnoverLimitKop")
  );
}

export async function GET(req: Request) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const asOf = new Date();
  console.log("[bank/accounts-footer-summary] GET, asOf:", asOf.toISOString(), "| db:", getDbHostForLog());

  type AccRow = {
    id: string;
    balance: bigint;
    currencyCode: number;
    maskedPan: string | null;
    iban: string | null;
    externalId: string | null;
    fopAnnualTurnoverLimitKop: bigint | null;
    connection: { id: string; name: string; clientName: string | null };
  };

  let accounts: AccRow[];
  try {
    accounts = await prisma.bankAccount.findMany({
      where: { includeInOperationsTable: true },
      orderBy: [{ connection: { createdAt: "desc" } }, { id: "asc" }],
      select: {
        id: true,
        balance: true,
        currencyCode: true,
        maskedPan: true,
        iban: true,
        externalId: true,
        fopAnnualTurnoverLimitKop: true,
        connection: { select: { id: true, name: true, clientName: true } },
      },
    });
  } catch (fetchErr) {
    if (!isMissingFopOrOpeningColumns(fetchErr)) throw fetchErr;
    console.warn(
      "[bank/accounts-footer-summary] Колонки ліміту/відліку відсутні, зведення без річного ліміту:",
      fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
    );
    const basic = await prisma.bankAccount.findMany({
      where: { includeInOperationsTable: true },
      orderBy: [{ connection: { createdAt: "desc" } }, { id: "asc" }],
      select: {
        id: true,
        balance: true,
        currencyCode: true,
        maskedPan: true,
        iban: true,
        externalId: true,
        connection: { select: { id: true, name: true, clientName: true } },
      },
    });
    accounts = basic.map((a) => ({ ...a, fopAnnualTurnoverLimitKop: null }));
  }

  const uahIds = accounts.filter((a) => (a.currencyCode ?? UAH) === UAH).map((a) => a.id);
  const ytdMap = new Map<string, bigint>();
  await Promise.all(
    uahIds.map(async (id) => {
      try {
        const ytd = await computeYtdIncomingKopThrough(id, asOf);
        ytdMap.set(id, ytd);
      } catch (e) {
        console.warn(
          "[bank/accounts-footer-summary] YTD для рахунку",
          id,
          "пропущено:",
          e instanceof Error ? e.message : String(e)
        );
        ytdMap.set(id, 0n);
      }
    })
  );

  const list = accounts.map((a) => {
    const conn = a.connection;
    const owner = conn.clientName ?? conn.name ?? "—";
    const accountLast4 =
      last4(a.maskedPan) !== "—"
        ? last4(a.maskedPan)
        : last4(a.iban) !== "—"
          ? last4(a.iban)
          : last4(a.externalId);
    const isUah = (a.currencyCode ?? UAH) === UAH;
    const limitKop = isUah && a.fopAnnualTurnoverLimitKop != null && a.fopAnnualTurnoverLimitKop > 0n ? a.fopAnnualTurnoverLimitKop : null;
    const ytdKop = isUah ? (ytdMap.get(a.id) ?? 0n) : null;
    let remainingKop: bigint | null = null;
    if (limitKop != null && ytdKop != null) {
      remainingKop = limitKop - ytdKop;
    }
    return {
      accountId: a.id,
      connectionId: conn.id,
      label: `${owner.trim().split(/\s+/)[0] || "—"} (${accountLast4})`,
      currencyCode: a.currencyCode ?? UAH,
      balanceKop: a.balance.toString(),
      ytdIncomingKop: ytdKop != null ? ytdKop.toString() : null,
      annualLimitKop: limitKop != null ? limitKop.toString() : null,
      annualRemainingKop: remainingKop != null ? remainingKop.toString() : null,
    };
  });

  console.log("[bank/accounts-footer-summary] рахунків:", list.length);

  return NextResponse.json(
    {
      ok: true,
      computedAt: asOf.toISOString(),
      accounts: list,
      note:
        "Залишок ліміту = річний ліміт − надходження (додатні операції Monobank) з 1 січня UTC поточного року до моменту запиту.",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    }
  );
}
