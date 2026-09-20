import { NextRequest, NextResponse } from "next/server";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";
import {
  listVisitPaymentFilterAccounts,
  listVisitPayments,
} from "@/lib/finance/visit-payments";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const url = req.nextUrl;
    const withOptions = url.searchParams.get("options") === "1";
    const [payments, accounts] = await Promise.all([
      listVisitPayments({
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        accountId: url.searchParams.get("accountId")
          ? Number(url.searchParams.get("accountId"))
          : null,
        paymentKind: (url.searchParams.get("paymentKind") as "account" | "deposit" | "all") || "all",
        q: url.searchParams.get("q"),
        sort:
          (url.searchParams.get("sort") as
            | "date_desc"
            | "date_asc"
            | "amount_desc"
            | "amount_asc") || "date_desc",
        limit: Number(url.searchParams.get("limit") || 100),
      }),
      withOptions ? listVisitPaymentFilterAccounts() : Promise.resolve(null),
    ]);
    return NextResponse.json({
      ok: true,
      payments,
      ...(accounts ? { accounts } : {}),
    });
  } catch (err) {
    console.error("[api/admin/finance/visit-payments] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка списку оплат" },
      { status: 500 },
    );
  }
}
