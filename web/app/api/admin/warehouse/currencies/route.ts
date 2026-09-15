import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import {
  disableSystemCurrency,
  enableSystemCurrency,
  listSystemCurrencies,
} from "@/lib/warehouse/currencies";
import { allCountries, CURRENCY_DIRECTORY } from "@/lib/warehouse/currency-catalog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "view");
  if (auth instanceof NextResponse) return auth;

  try {
    const enabled = await listSystemCurrencies();
    return NextResponse.json({
      ok: true,
      directory: CURRENCY_DIRECTORY,
      countries: allCountries(),
      enabled,
    });
  } catch (err) {
    console.error("[api/admin/warehouse/currencies] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка валют" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "");
    if (body.enabled === false) {
      const row = await disableSystemCurrency(code);
      return NextResponse.json({ ok: true, currency: row });
    }
    const row = await enableSystemCurrency(code);
    return NextResponse.json({ ok: true, currency: row });
  } catch (err) {
    console.error("[api/admin/warehouse/currencies] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка збереження валюти";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
