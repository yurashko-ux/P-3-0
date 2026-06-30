import { NextRequest, NextResponse } from "next/server";
import {
  diagnoseClientDepositsAccess,
  fetchChainClientDeposits,
  type ClientDepositsDiagnostics,
} from "@/lib/altegio/client-deposits";
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
 * GET /api/admin/altegio/client-deposits
 *
 * Query:
 * - balanceFrom (default 0.01)
 * - balanceTo
 * - limit (per page, default 200)
 * - maxPages (default 50)
 * - chainId (optional override)
 * - diagnose=1 — швидка діагностика прав (без перебору клієнтів)
 * - previewLimit (скільки рядків показати у відповіді, default 100)
 */
export async function GET(req: NextRequest) {
  if (!isDirectApiAuthorized(req)) {
    return unauthorizedResponse(req);
  }

  const chainId = parseNumberParam(req.nextUrl.searchParams.get("chainId"));
  const diagnoseOnly = req.nextUrl.searchParams.get("diagnose") === "1";

  if (diagnoseOnly) {
    try {
      const diagnostics = await diagnoseClientDepositsAccess({ chainId });
      return NextResponse.json({ ok: true, diagnostics });
    } catch (error) {
      console.error("[admin/altegio/client-deposits] diagnose error:", error);
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Помилка діагностики deposits API",
        },
        { status: 500 },
      );
    }
  }

  try {
    const balanceFrom = parseNumberParam(req.nextUrl.searchParams.get("balanceFrom")) ?? 0.01;
    const balanceTo = parseNumberParam(req.nextUrl.searchParams.get("balanceTo"));
    const limitPerPage = parseNumberParam(req.nextUrl.searchParams.get("limit")) ?? 200;
    const maxPages = parseNumberParam(req.nextUrl.searchParams.get("maxPages")) ?? 50;
    const previewLimit = Math.min(
      Math.max(parseNumberParam(req.nextUrl.searchParams.get("previewLimit")) ?? 100, 1),
      500,
    );

    const result = await fetchChainClientDeposits({
      chainId,
      balanceFrom,
      balanceTo,
      limitPerPage,
      maxPages,
    });

    return NextResponse.json({
      ok: true,
      result: {
        chainId: result.chainId,
        companyId: result.companyId,
        source: result.source,
        chainCandidatesTried: result.chainCandidatesTried,
        balanceFrom: result.balanceFrom,
        balanceTo: result.balanceTo,
        totalDeposits: result.totalDeposits,
        totalBalance: result.totalBalance,
        pagesFetched: result.pagesFetched,
        clientsChecked: result.clientsChecked,
        locationDepositsForbidden: result.locationDepositsForbidden,
        locationDepositsEmpty: result.locationDepositsEmpty,
        preview: result.deposits.slice(0, previewLimit).map((item) => ({
          depositId: item.depositId,
          clientId: item.clientId,
          clientName: item.clientName,
          clientPhone: item.clientPhone,
          balance: item.balance,
          depositTypeTitle: item.depositTypeTitle,
          blocked: item.blocked,
        })),
        deposits: result.deposits,
      },
    });
  } catch (error) {
    console.error("[admin/altegio/client-deposits] GET error:", error);
    const diagnostics = (error as Error & { diagnostics?: ClientDepositsDiagnostics }).diagnostics;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка отримання клієнтських балансів Altegio",
        diagnostics,
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
    const balanceFrom = typeof body.balanceFrom === "number" ? body.balanceFrom : 0.01;
    const balanceTo = typeof body.balanceTo === "number" ? body.balanceTo : undefined;
    const limitPerPage = typeof body.limit === "number" ? body.limit : 200;
    const maxPages = typeof body.maxPages === "number" ? body.maxPages : 50;
    const chainId = typeof body.chainId === "number" ? body.chainId : undefined;
    const previewLimit = typeof body.previewLimit === "number" ? body.previewLimit : 100;

    const result = await fetchChainClientDeposits({
      chainId,
      balanceFrom,
      balanceTo,
      limitPerPage,
      maxPages,
    });

    return NextResponse.json({
      ok: true,
      result: {
        chainId: result.chainId,
        companyId: result.companyId,
        source: result.source,
        chainCandidatesTried: result.chainCandidatesTried,
        balanceFrom: result.balanceFrom,
        balanceTo: result.balanceTo,
        totalDeposits: result.totalDeposits,
        totalBalance: result.totalBalance,
        pagesFetched: result.pagesFetched,
        clientsChecked: result.clientsChecked,
        locationDepositsForbidden: result.locationDepositsForbidden,
        locationDepositsEmpty: result.locationDepositsEmpty,
        preview: result.deposits.slice(0, previewLimit).map((item) => ({
          depositId: item.depositId,
          clientId: item.clientId,
          clientName: item.clientName,
          clientPhone: item.clientPhone,
          balance: item.balance,
          depositTypeTitle: item.depositTypeTitle,
          blocked: item.blocked,
        })),
        deposits: result.deposits,
      },
    });
  } catch (error) {
    console.error("[admin/altegio/client-deposits] POST error:", error);
    const diagnostics = (error as Error & { diagnostics?: ClientDepositsDiagnostics }).diagnostics;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Помилка отримання клієнтських балансів Altegio",
        diagnostics,
      },
      { status: 500 },
    );
  }
}
