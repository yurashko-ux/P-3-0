// GET: компактні дані для футера сторінки Банк (активні рахунки таблиці)

import { NextResponse } from "next/server";
import { prisma, getDbHostForLog } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { computeYtdIncomingKopThrough } from "@/lib/bank/fop-turnover";
import { computeAltegioBalanceKopForFooter } from "@/lib/bank/altegio-opening-anchor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UAH = 980;

function last4(s: string | null): string {
  if (!s) return "—";
  const digits = s.replace(/\D/g, "");
  return digits.slice(-4) || "—";
}

function isMissingOptionalColumns(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return (
    m.includes("altegioOpeningBalanceManual") ||
    m.includes("altegioOpeningBalanceDate") ||
    m.includes("altegioMonthlyTurnoverManual") ||
    m.includes("fopAnnualTurnoverLimitKop") ||
    m.includes("ytdIncomingManualKop") ||
    m.includes("ytdIncomingManualThroughDate")
  );
}

const selectConnection = { select: { name: true, clientName: true } } as const;

export async function GET(req: Request) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const asOf = new Date();
  console.log("[bank/accounts-footer-strip] GET asOf:", asOf.toISOString(), "| db:", getDbHostForLog());

  type AccSelect = {
    id: string;
    balance: bigint;
    currencyCode: number;
    maskedPan: string | null;
    iban: string | null;
    externalId: string | null;
    altegioBalance: bigint | null;
    altegioOpeningBalanceManual: bigint | null;
    altegioOpeningBalanceDate: Date | null;
    fopAnnualTurnoverLimitKop: bigint | null;
    ytdIncomingManualKop: bigint | null;
    ytdIncomingManualThroughDate: Date | null;
    connection: { name: string; clientName: string | null };
  };

  let accounts: AccSelect[];
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
        altegioBalance: true,
        altegioOpeningBalanceManual: true,
        altegioOpeningBalanceDate: true,
        fopAnnualTurnoverLimitKop: true,
        ytdIncomingManualKop: true,
        ytdIncomingManualThroughDate: true,
        connection: selectConnection,
      },
    });
  } catch (e) {
    if (!isMissingOptionalColumns(e)) throw e;
    console.warn(
      "[bank/accounts-footer-strip] Повний select (з YTD) недоступний, пробуємо без колонок YTD:",
      e instanceof Error ? e.message : String(e),
    );
    try {
      const rows = await prisma.bankAccount.findMany({
        where: { includeInOperationsTable: true },
        orderBy: [{ connection: { createdAt: "desc" } }, { id: "asc" }],
        select: {
          id: true,
          balance: true,
          currencyCode: true,
          maskedPan: true,
          iban: true,
          externalId: true,
          altegioBalance: true,
          altegioOpeningBalanceManual: true,
          altegioOpeningBalanceDate: true,
          fopAnnualTurnoverLimitKop: true,
          connection: selectConnection,
        },
      });
      accounts = rows.map((a) => ({
        ...a,
        ytdIncomingManualKop: null,
        ytdIncomingManualThroughDate: null,
      }));
    } catch (e2) {
      if (!isMissingOptionalColumns(e2)) throw e2;
      console.warn(
        "[bank/accounts-footer-strip] Спрощений select без частини полів Altegio/ліміту:",
        e2 instanceof Error ? e2.message : String(e2),
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
          altegioBalance: true,
          connection: selectConnection,
        },
      });
      accounts = basic.map((a) => ({
        ...a,
        altegioOpeningBalanceManual: null,
        altegioOpeningBalanceDate: null,
        fopAnnualTurnoverLimitKop: null,
        ytdIncomingManualKop: null,
        ytdIncomingManualThroughDate: null,
      }));
    }
  }

  const rows = await Promise.all(
    accounts.map(async (a) => {
      const conn = a.connection;
      const owner = conn.clientName ?? conn.name ?? "—";
      const surname = owner.trim().split(/\s+/)[0] || "—";
      const accountLast4 =
        last4(a.maskedPan) !== "—"
          ? last4(a.maskedPan)
          : last4(a.iban) !== "—"
            ? last4(a.iban)
            : last4(a.externalId);
      const label = `${surname} (${accountLast4})`;

      const isUah = (a.currencyCode ?? UAH) === UAH;

      const ab = await computeAltegioBalanceKopForFooter(
        {
          id: a.id,
          currencyCode: a.currencyCode ?? UAH,
          altegioBalance: a.altegioBalance,
          altegioOpeningBalanceManual: a.altegioOpeningBalanceManual,
          altegioOpeningBalanceDate: a.altegioOpeningBalanceDate,
        },
        asOf
      );

      let ytdKop: bigint | null = null;
      let remainingKop: bigint | null = null;
      if (isUah) {
        try {
          ytdKop = await computeYtdIncomingKopThrough(a.id, asOf, {
            ytdIncomingManualKop: a.ytdIncomingManualKop,
            ytdIncomingManualThroughDate: a.ytdIncomingManualThroughDate,
          });
        } catch (err) {
          console.warn(
            "[bank/accounts-footer-strip] YTD, fallback лише виписка:",
            a.id,
            err instanceof Error ? err.message : err,
          );
          try {
            ytdKop = await computeYtdIncomingKopThrough(a.id, asOf, {
              ytdIncomingManualKop: null,
              ytdIncomingManualThroughDate: null,
            });
          } catch {
            ytdKop = null;
          }
        }
        const lim = a.fopAnnualTurnoverLimitKop;
        if (lim != null && lim > 0n && ytdKop != null) {
          remainingKop = lim - ytdKop;
        }
      }

      const limitKop =
        isUah && a.fopAnnualTurnoverLimitKop != null && a.fopAnnualTurnoverLimitKop > 0n
          ? a.fopAnnualTurnoverLimitKop.toString()
          : null;

      return {
        accountId: a.id,
        label,
        currencyCode: a.currencyCode ?? UAH,
        bankBalanceKop: a.balance.toString(),
        altegioBalanceKop: ab.kop != null ? ab.kop.toString() : null,
        altegioIsEstimate: ab.isEstimate,
        ytdIncomingKop: ytdKop != null ? ytdKop.toString() : null,
        annualLimitKop: limitKop,
        annualRemainingKop: remainingKop != null ? remainingKop.toString() : null,
      };
    })
  );

  return NextResponse.json(
    { ok: true, computedAt: asOf.toISOString(), accounts: rows },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    }
  );
}
