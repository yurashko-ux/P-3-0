// Етап A: порівняння доходів Altegio (джерело зведення зараз) з доходами Kresco.
// Лише читання, зведення не змінює.
// GET https://p-3-0.vercel.app/api/admin/bank/payment-reconciliation/income-source-compare?from=YYYY-MM-DD&to=YYYY-MM-DD&live=0

import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { compareIncomeSources, getBankIncomeSourceMode } from "@/lib/bank/incoming-kresco-income";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  if (getBankIncomeSourceMode() === "altegio") {
    return NextResponse.json(
      { ok: false, error: "Порівняння вимкнено (BANK_INCOME_SOURCE=altegio)" },
      { status: 409 },
    );
  }

  try {
    const from = req.nextUrl.searchParams.get("from")?.trim() || "";
    const to = req.nextUrl.searchParams.get("to")?.trim() || "";
    const result = await compareIncomeSources({
      dateFrom: YMD.test(from) ? from : undefined,
      dateTo: YMD.test(to) ? to : undefined,
      fetchLive: req.nextUrl.searchParams.get("live") !== "0",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[income-source-compare] Помилка порівняння:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося порівняти доходи" },
      { status: 500 },
    );
  }
}
