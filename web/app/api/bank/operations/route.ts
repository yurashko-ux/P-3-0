// web/app/api/bank/operations/route.ts
// GET: операції з усіх рахунків за період, з фільтрами direction та connectionId

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getCurrentMonthRange(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

function parseYmdBoundary(value: string, boundary: "start" | "end"): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("Невірний формат дати");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("Невірний формат дати");
  }
  const date =
    boundary === "start"
      ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  if (Number.isNaN(date.getTime())) throw new Error("Невірний формат дати");
  return date;
}

function parseCursor(cursor: string | null): { time: Date; id: string } | null {
  if (!cursor) return null;
  const [timeRaw, idRaw] = cursor.split("|");
  if (!timeRaw || !idRaw) return null;
  const time = new Date(timeRaw);
  if (Number.isNaN(time.getTime())) return null;
  return { time, id: idRaw };
}

function isMissingAltegioBankColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("altegioBalanceSnapshot") ||
    message.includes("altegioAccountTitleSnapshot") ||
    message.includes("altegioBalanceCapturedAt") ||
    message.includes("altegioSyncErrorSnapshot")
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const direction = req.nextUrl.searchParams.get("direction") || "all";
  const connectionIdParam = req.nextUrl.searchParams.get("connectionId");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const cursorParam = req.nextUrl.searchParams.get("cursor");

  let fromDate: Date;
  let toDate: Date;
  try {
    if (fromParam && toParam) {
      fromDate = parseYmdBoundary(fromParam, "start");
      toDate = parseYmdBoundary(toParam, "end");
    } else {
      const range = getCurrentMonthRange();
      fromDate = range.from;
      toDate = range.to;
    }
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new Error("Невірний формат дати");
    }
  } catch {
    return NextResponse.json(
      { error: "Невірні параметри from/to (очікується ISO дата)" },
      { status: 400 }
    );
  }

  const connectionId = connectionIdParam && connectionIdParam.trim() ? connectionIdParam.trim() : null;
  const parsedCursor = parseCursor(cursorParam);
  const parsedLimit = Number.parseInt(limitParam ?? "50", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

  try {
    const accountWhere: { connectionId?: string; includeInOperationsTable: boolean } = {
      includeInOperationsTable: true,
    };
    if (connectionId) accountWhere.connectionId = connectionId;

    const where: any = {
      time: { gte: fromDate, lte: toDate },
      account: accountWhere,
    };

    if (direction === "in") {
      where.amount = { gt: BigInt(0) };
    } else if (direction === "out") {
      where.amount = { lt: BigInt(0) };
    }

    if (parsedCursor) {
      where.AND = [
        {
          OR: [
            { time: { lt: parsedCursor.time } },
            { time: parsedCursor.time, id: { lt: parsedCursor.id } },
          ],
        },
      ];
    }

    let items: any[];
    try {
      items = await prisma.bankStatementItem.findMany({
        where,
        orderBy: [{ time: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          time: true,
          amount: true,
          balance: true,
          description: true,
          comment: true,
          counterName: true,
          altegioBalanceSnapshot: true,
          altegioAccountTitleSnapshot: true,
          altegioBalanceCapturedAt: true,
          altegioSyncErrorSnapshot: true,
          account: {
            select: {
              id: true,
              maskedPan: true,
              iban: true,
              externalId: true,
              currencyCode: true,
              connection: {
                select: { id: true, name: true, clientName: true },
              },
            },
          },
        },
      });
    } catch (error) {
      if (!isMissingAltegioBankColumnError(error)) {
        throw error;
      }

      console.warn(
        "[bank/operations] Snapshot-поля Altegio для BankStatementItem ще недоступні в БД, віддаємо дані без колонки Баланс Альтеджіо:",
        error instanceof Error ? error.message : String(error),
      );

      items = await prisma.bankStatementItem.findMany({
        where,
        orderBy: [{ time: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          time: true,
          amount: true,
          balance: true,
          description: true,
          comment: true,
          counterName: true,
          account: {
            select: {
              id: true,
              maskedPan: true,
              iban: true,
              externalId: true,
              currencyCode: true,
              connection: {
                select: { id: true, name: true, clientName: true },
              },
            },
          },
        },
      });
    }

    function last4(s: string | null): string {
      if (!s) return "—";
      const digits = s.replace(/\D/g, "");
      return digits.slice(-4) || "—";
    }

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;

    const list = pageItems.map((i) => {
      const acc = i.account;
      const conn = acc.connection;
      const owner = conn.clientName ?? conn.name ?? "—";
      const accountLast4 =
        last4(acc.maskedPan ?? null) !== "—"
          ? last4(acc.maskedPan ?? null)
          : last4(acc.iban ?? null) !== "—"
            ? last4(acc.iban ?? null)
            : last4(acc.externalId ?? null);
      return {
        id: i.id,
        time: i.time.toISOString(),
        amount: i.amount.toString(),
        balance: i.balance != null ? i.balance.toString() : null,
        description: i.description,
        comment: i.comment ?? null,
        counterName: i.counterName ?? null,
        owner,
        connectionId: conn.id,
        accountId: acc.id,
        accountLast4,
        currencyCode: acc.currencyCode ?? 980,
        altegioBalance:
          "altegioBalanceSnapshot" in i && i.altegioBalanceSnapshot != null
            ? i.altegioBalanceSnapshot.toString()
            : null,
        altegioAccountTitle:
          "altegioAccountTitleSnapshot" in i ? i.altegioAccountTitleSnapshot ?? null : null,
        altegioBalanceUpdatedAt:
          "altegioBalanceCapturedAt" in i ? i.altegioBalanceCapturedAt?.toISOString() ?? null : null,
        altegioSyncError: "altegioSyncErrorSnapshot" in i ? i.altegioSyncErrorSnapshot ?? null : null,
      };
    });

    const lastItem = pageItems[pageItems.length - 1];
    const nextCursor = hasMore && lastItem ? `${lastItem.time.toISOString()}|${lastItem.id}` : null;

    return NextResponse.json(
      {
        ok: true,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        items: list,
        hasMore,
        nextCursor,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (err) {
    console.error("[bank/operations] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка завантаження операцій" },
      { status: 500 }
    );
  }
}
