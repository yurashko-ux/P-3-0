import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { getUsdUahRate } from "@/lib/warehouse/fx";

export const dynamic = "force-dynamic";

/** GET https://p-3-0.vercel.app/api/admin/warehouse/fx — денний робочий курс USD/UAH */
export async function GET(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "view");
  if (auth instanceof NextResponse) return auth;

  try {
    const year = Number(req.nextUrl.searchParams.get("year") || 0);
    const month = Number(req.nextUrl.searchParams.get("month") || 0);
    const row = await getUsdUahRate(year || undefined, month || undefined);
    console.log(
      `[api/admin/warehouse/fx] source=${row.source} rate=${row.rate ?? "—"} day=${row.kyivDay ?? "—"}`,
    );
    return NextResponse.json({ ok: true, ...row });
  } catch (err) {
    console.error("[api/admin/warehouse/fx] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка курсу" },
      { status: 500 },
    );
  }
}
