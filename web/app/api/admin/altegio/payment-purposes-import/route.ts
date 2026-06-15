import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  ALTEGIO_FINANCE_SYNC_START_DATE,
} from "@/lib/altegio/finance-transactions-sync";
import { importAltegioPaymentPurposes } from "@/lib/altegio/payment-purpose-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const dateFrom = req.nextUrl.searchParams.get("dateFrom") || ALTEGIO_FINANCE_SYNC_START_DATE;
    const dateTo = req.nextUrl.searchParams.get("dateTo") || undefined;
    const maxPages = Number(req.nextUrl.searchParams.get("maxPages") || 5);
    const dryRun = req.nextUrl.searchParams.get("dryRun") !== "0";
    const result = await importAltegioPaymentPurposes({ dateFrom, dateTo, maxPages, dryRun });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[admin/altegio/payment-purposes-import] Помилка GET:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка імпорту статей Altegio" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : ALTEGIO_FINANCE_SYNC_START_DATE;
    const dateTo = typeof body.dateTo === "string" ? body.dateTo : undefined;
    const maxPages = typeof body.maxPages === "number" ? body.maxPages : 5;
    const dryRun = body.dryRun !== false;
    const result = await importAltegioPaymentPurposes({ dateFrom, dateTo, maxPages, dryRun });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[admin/altegio/payment-purposes-import] Помилка POST:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка імпорту статей Altegio" },
      { status: 500 },
    );
  }
}
