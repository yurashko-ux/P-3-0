import { NextRequest, NextResponse } from "next/server";
import {
  archiveOverview,
  getArchiveClientDetail,
  listArchiveFinance,
  searchArchiveClients,
} from "@/lib/altegio/archive";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const altegioClientId = Number(req.nextUrl.searchParams.get("clientId") || "");
    if (altegioClientId > 0) {
      const detail = await getArchiveClientDetail(altegioClientId);
      return NextResponse.json({ ok: true, detail });
    }
    const from = String(req.nextUrl.searchParams.get("from") || "").trim();
    const to = String(req.nextUrl.searchParams.get("to") || "").trim();
    if (from && to) {
      const finance = await listArchiveFinance(from, to);
      return NextResponse.json({ ok: true, finance });
    }
    if (req.nextUrl.searchParams.has("q")) {
      const clients = await searchArchiveClients(req.nextUrl.searchParams.get("q") || "");
      return NextResponse.json({ ok: true, clients });
    }
    const overview = await archiveOverview();
    return NextResponse.json({
      ok: true,
      overview: {
        clients: overview.clients,
        appointments: overview.appointments,
        payments: overview.payments,
        finance: overview.finance,
        cursors: overview.cursors.map((row) => ({
          syncKey: row.syncKey,
          cursor: row.cursor,
          status: row.status,
          detail: row.detail,
        })),
        checks: overview.checks.map((row) => ({
          kyivMonth: row.kyivMonth,
          kind: row.kind,
          apiCount: row.apiCount,
          dbCount: row.dbCount,
          dbAmount: row.dbAmount,
          note: row.note,
        })),
      },
    });
  } catch (err) {
    console.error("[api/admin/finance/archive] GET error:", err);
    const message = err instanceof Error ? err.message : "Помилка архіву";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
