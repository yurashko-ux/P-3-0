import { NextRequest, NextResponse } from "next/server";
import { fetchClientCardBalances } from "@/lib/altegio/client-balances";
import { getDirectApiAuthDebug, isDirectApiAuthorized } from "@/lib/direct-api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function unauthorizedResponse(req: NextRequest) {
  return NextResponse.json(
    { ok: false, error: "Unauthorized", authDebug: getDirectApiAuthDebug(req) },
    { status: 401 },
  );
}

function parseNumberParam(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * GET /api/admin/altegio/client-balances
 *
 * Query:
 * - limit (per page, default 100)
 * - maxPages (default 50)
 * - companyId (optional override)
 * - excludeZero (default 1) — лише balance !== 0
 * - previewLimit (default 100)
 */
export async function GET(req: NextRequest) {
  if (!isDirectApiAuthorized(req)) {
    return unauthorizedResponse(req);
  }

  try {
    const limitPerPage = parseNumberParam(req.nextUrl.searchParams.get("limit")) ?? 100;
    const maxPages = parseNumberParam(req.nextUrl.searchParams.get("maxPages")) ?? 50;
    const companyId = parseNumberParam(req.nextUrl.searchParams.get("companyId"));
    const excludeZero = req.nextUrl.searchParams.get("excludeZero") !== "0";
    const previewLimit = Math.min(
      Math.max(parseNumberParam(req.nextUrl.searchParams.get("previewLimit")) ?? 100, 1),
      500,
    );

    const result = await fetchClientCardBalances({
      companyId,
      limitPerPage,
      maxPages,
      excludeZero,
    });

    return NextResponse.json({
      ok: true,
      result: {
        companyId: result.companyId,
        source: result.source,
        searchStrategy: result.searchStrategy,
        clientsScanned: result.clientsScanned,
        pagesFetched: result.pagesFetched,
        totalNonZero: result.totalNonZero,
        totalPositive: result.totalPositive,
        totalNegative: result.totalNegative,
        sumBalance: result.sumBalance,
        preview: result.clients.slice(0, previewLimit).map((item) => ({
          clientId: item.clientId,
          clientName: item.clientName,
          clientPhone: item.clientPhone,
          balance: item.balance,
          soldAmount: item.soldAmount,
          spent: item.spent,
          lastVisitDate: item.lastVisitDate,
        })),
        clients: result.clients,
      },
    });
  } catch (error) {
    console.error("[admin/altegio/client-balances] GET error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка отримання балансів клієнтів Altegio",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isDirectApiAuthorized(req)) {
    return unauthorizedResponse(req);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const limitPerPage = typeof body.limit === "number" ? body.limit : 100;
    const maxPages = typeof body.maxPages === "number" ? body.maxPages : 50;
    const companyId = typeof body.companyId === "number" ? body.companyId : undefined;
    const excludeZero = body.excludeZero !== false;
    const previewLimit = typeof body.previewLimit === "number" ? body.previewLimit : 100;

    const result = await fetchClientCardBalances({
      companyId,
      limitPerPage,
      maxPages,
      excludeZero,
    });

    return NextResponse.json({
      ok: true,
      result: {
        companyId: result.companyId,
        source: result.source,
        searchStrategy: result.searchStrategy,
        clientsScanned: result.clientsScanned,
        pagesFetched: result.pagesFetched,
        totalNonZero: result.totalNonZero,
        totalPositive: result.totalPositive,
        totalNegative: result.totalNegative,
        sumBalance: result.sumBalance,
        preview: result.clients.slice(0, previewLimit).map((item) => ({
          clientId: item.clientId,
          clientName: item.clientName,
          clientPhone: item.clientPhone,
          balance: item.balance,
          soldAmount: item.soldAmount,
          spent: item.spent,
          lastVisitDate: item.lastVisitDate,
        })),
        clients: result.clients,
      },
    });
  } catch (error) {
    console.error("[admin/altegio/client-balances] POST error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка отримання балансів клієнтів Altegio",
      },
      { status: 500 },
    );
  }
}
