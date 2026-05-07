import { NextRequest, NextResponse } from "next/server";
import {
  fetchFinanceReportDiscountDetails,
  fetchFinanceReportDiscountTotal,
  getFinanceReportDiscountPeriod,
} from "@/lib/finance/finance-report-discounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get("secret");
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || month < 1 || month > 12) {
    return NextResponse.json(
      { ok: false, error: "Некоректні параметри year/month" },
      { status: 400 },
    );
  }

  const period = getFinanceReportDiscountPeriod(year, month);
  if (!period) {
    return NextResponse.json(
      { ok: true, discountAmount: 0, discountDetails: [], period: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [discountAmount, discountDetails] = await Promise.all([
    fetchFinanceReportDiscountTotal(year, month),
    fetchFinanceReportDiscountDetails(year, month),
  ]);

  return NextResponse.json(
    {
      ok: true,
      discountAmount,
      discountDetails,
      period,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
