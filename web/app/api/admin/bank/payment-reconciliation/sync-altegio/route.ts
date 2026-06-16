import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import {
  ALTEGIO_FINANCE_SYNC_START_DATE,
  syncAltegioFinanceTransactions,
} from "@/lib/altegio/finance-transactions-sync";
import { importAltegioPaymentPurposes } from "@/lib/altegio/payment-purpose-import";
import { reconcileBankAltegioPayments } from "@/lib/bank/altegio-payment-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function kyivDayUtcRange(ymd: string): { from: string; to: string } {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMidday);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 12);
  const offsetHours = hour - 12;
  const from = new Date(Date.UTC(year, month - 1, day, 0 - offsetHours, 0, 0, 0));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function reconcileBoundary(value: string | undefined, boundary: "from" | "to"): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const range = kyivDayUtcRange(value);
    return boundary === "from" ? range.from : range.to;
  }
  return value;
}

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : ALTEGIO_FINANCE_SYNC_START_DATE;
    const dateTo = typeof body.dateTo === "string" ? body.dateTo : undefined;
    const maxPages = typeof body.maxPages === "number" ? body.maxPages : undefined;

    const altegio = await syncAltegioFinanceTransactions({
      dateFrom,
      dateTo,
      maxPages,
      syncPurposes: true,
    });
    const purposes = await importAltegioPaymentPurposes({
      dateFrom,
      dateTo,
      dryRun: false,
      maxPages: 5,
    });
    const reconcile = await reconcileBankAltegioPayments({
      from: reconcileBoundary(dateFrom, "from"),
      to: reconcileBoundary(dateTo, "to"),
      limit: 1000,
    });

    return NextResponse.json({ ok: true, result: { altegio, purposes, reconcile } });
  } catch (error) {
    console.error("[payment-reconciliation/sync-altegio] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка синхронізації платежів Altegio" },
      { status: 500 },
    );
  }
}
