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
      pausedAt: c.pausedAt ? c.pausedAt.toISOString() : null,
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

    // Запобіжник: каскад стер би банківські платежі разом із їхніми зведеннями з Altegio.
    // Якщо по рахунках підключення є хоч одна звʼязана операція — не видаляємо.
    const linked = await countConnectionLinkedOperations(id);
    const linkedTotal = Object.values(linked).reduce((sum, n) => sum + n, 0);
    if (linkedTotal > 0) {
      const parts = [
        linked.paymentMatches ? `зведених витрат: ${linked.paymentMatches}` : "",
        linked.incomingMatches ? `зведених надходжень: ${linked.incomingMatches}` : "",
        linked.depositMatches ? `зведених завдатків: ${linked.depositMatches}` : "",
        linked.pendingPayments ? `платежів в очікуванні Altegio: ${linked.pendingPayments}` : "",
        linked.automaticExpenses ? `автоматичних витрат Altegio: ${linked.automaticExpenses}` : "",
      ].filter(Boolean);
      console.warn("[bank/connections] DELETE заблоковано — є звʼязані операції", { id, ...linked });
      return NextResponse.json(
        {
          error:
            `Підключення не можна видалити: по його рахунках є звʼязані операції (${parts.join(", ")}). ` +
            `Видалення стерло б банківську історію. Щоб прибрати рахунок з Каси, приховайте його у Фінанси → «Архів Altegio».`,
          linked,
        },
        { status: 409 },
      );
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

/** Звʼязані операції по рахунках підключення: зведення з Altegio, очікування, автоматичні витрати. */
async function countConnectionLinkedOperations(connectionId: string) {
  const byItem = { bankStatementItem: { account: { connectionId } } };
  const [paymentMatches, incomingMatches, depositMatches, pendingPayments, automaticExpenses] = await Promise.all([
    prisma.bankAltegioPaymentMatch.count({ where: byItem }),
    prisma.bankAltegioIncomingMatch.count({ where: byItem }),
    prisma.bankAltegioDepositMatch.count({ where: byItem }),
    prisma.bankAltegioPendingPayment.count({ where: byItem }),
    prisma.bankAutomaticAltegioExpense.count({ where: { bankAccount: { connectionId } } }),
  ]);
  return { paymentMatches, incomingMatches, depositMatches, pendingPayments, automaticExpenses };
}
