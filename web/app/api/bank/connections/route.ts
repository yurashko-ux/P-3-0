// web/app/api/bank/connections/route.ts
// GET: список підключень та рахунків (без токена)

import { NextResponse } from "next/server";
import { prisma, getDbHostForLog } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// waitForReplica: затримка перед читанням (сек), щоб репліка встигла отримати дані після запису (Accelerate)
const MAX_WAIT_SEC = 10;

const accountSelectBase = {
  id: true,
  externalId: true,
  balance: true,
  currencyCode: true,
  type: true,
  iban: true,
  maskedPan: true,
  includeInOperationsTable: true,
} as const;

function isMissingOpeningBalanceColumns(err: unknown): boolean {
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

export async function GET(req: Request) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const waitSec = Math.min(MAX_WAIT_SEC, Math.max(0, parseInt(url.searchParams.get("waitForReplica") ?? "0", 10) || 0));
  if (waitSec > 0) {
    console.log("[bank/connections] GET waiting for replica:", waitSec, "s");
    await new Promise((r) => setTimeout(r, waitSec * 1000));
  }
  console.log("[bank/connections] GET received, auth ok");

  try {
    let connections;
    try {
      connections = await prisma.bankConnection.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          accounts: {
            select: {
              ...accountSelectBase,
              altegioOpeningBalanceManual: true,
              altegioOpeningBalanceDate: true,
              altegioMonthlyTurnoverManual: true,
              ytdIncomingManualKop: true,
              ytdIncomingManualThroughDate: true,
              fopAnnualTurnoverLimitKop: true,
            },
          },
        },
      });
    } catch (fetchErr) {
      if (!isMissingOpeningBalanceColumns(fetchErr)) throw fetchErr;
      console.warn(
        "[bank/connections] Колонки точки відліку Altegio відсутні в БД, список без них:",
        fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      );
      connections = await prisma.bankConnection.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          accounts: { select: { ...accountSelectBase } },
        },
      });
    }

    const list = connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      name: c.name,
      clientName: c.clientName,
      webhookUrl: c.webhookUrl,
      createdAt: c.createdAt.toISOString(),
      accounts: c.accounts.map((a) => {
        const openingManual =
          "altegioOpeningBalanceManual" in a && a.altegioOpeningBalanceManual != null
            ? a.altegioOpeningBalanceManual.toString()
            : null;
        const openingDate =
          "altegioOpeningBalanceDate" in a && a.altegioOpeningBalanceDate != null
            ? a.altegioOpeningBalanceDate.toISOString()
            : null;
        const monthlyTurnover =
          "altegioMonthlyTurnoverManual" in a && a.altegioMonthlyTurnoverManual != null
            ? a.altegioMonthlyTurnoverManual.toString()
            : null;
        const annualLimit =
          "fopAnnualTurnoverLimitKop" in a && a.fopAnnualTurnoverLimitKop != null
            ? a.fopAnnualTurnoverLimitKop.toString()
            : null;
        const ytdManual =
          "ytdIncomingManualKop" in a && a.ytdIncomingManualKop != null
            ? a.ytdIncomingManualKop.toString()
            : null;
        const ytdThrough =
          "ytdIncomingManualThroughDate" in a && a.ytdIncomingManualThroughDate != null
            ? a.ytdIncomingManualThroughDate.toISOString()
            : null;
        return {
          ...a,
          balance: a.balance.toString(),
          altegioOpeningBalanceManual: openingManual,
          altegioOpeningBalanceDate: openingDate,
          altegioMonthlyTurnoverManual: monthlyTurnover,
          ytdIncomingManualKop: ytdManual,
          ytdIncomingManualThroughDate: ytdThrough,
          fopAnnualTurnoverLimitKop: annualLimit,
        };
      }),
    }));

    console.log("[bank/connections] returning count:", list.length, "| db:", getDbHostForLog());
    return NextResponse.json(
      { ok: true, connections: list },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (err) {
    console.error("[bank/connections] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка завантаження" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Не вказано id підключення" }, { status: 400 });
    }

    // Каскадне видалення (BankAccount, BankStatementItem) через onDelete: Cascade у схемі
    await prisma.bankConnection.delete({ where: { id } });
    console.log("[bank/connections] DELETE ok, connection id:", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bank/connections] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Помилка видалення";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
