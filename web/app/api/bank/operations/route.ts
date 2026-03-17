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

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const direction = req.nextUrl.searchParams.get("direction") || "all";
  const connectionIdParam = req.nextUrl.searchParams.get("connectionId");

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

  try {
    const accountWhere: { connectionId?: string; includeInOperationsTable: boolean } = {
      includeInOperationsTable: true,
    };
    if (connectionId) accountWhere.connectionId = connectionId;

    const where: {
      time: { gte: Date; lte: Date };
      amount?: { gt?: bigint; lt?: bigint };
      account: { connectionId?: string; includeInOperationsTable: boolean };
    } = {
      time: { gte: fromDate, lte: toDate },
      account: accountWhere,
    };

    if (direction === "in") {
      where.amount = { gt: BigInt(0) };
    } else if (direction === "out") {
      where.amount = { lt: BigInt(0) };
    }

    const items = await prisma.bankStatementItem.findMany({
      where,
      orderBy: { time: "desc" },
      take: 2000,
      include: {
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

    function last4(s: string | null): string {
      if (!s) return "—";
      const digits = s.replace(/\D/g, "");
      return digits.slice(-4) || "—";
    }

    const list = items.map((i) => {
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
      };
    });

    return NextResponse.json({
      ok: true,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      items: list,
    });
  } catch (err) {
    console.error("[bank/operations] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка завантаження операцій" },
      { status: 500 }
    );
  }
}
