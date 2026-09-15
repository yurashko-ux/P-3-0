import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import { getNativeWarehouseBalance, getKyivYearMonth } from "@/lib/warehouse/stock";
import { queryWarehouseStockView, type WarehouseStockSort } from "@/lib/warehouse/query";

export const dynamic = "force-dynamic";

function parseHair(raw: string | null): "all" | "yes" | "no" {
  if (raw === "1" || raw === "yes") return "yes";
  if (raw === "0" || raw === "no") return "no";
  return "all";
}

function parseSort(raw: string | null): WarehouseStockSort {
  if (raw === "sku" || raw === "title" || raw === "category" || raw === "qty" || raw === "value" || raw === "storage") {
    return raw;
  }
  return "title";
}

export async function GET(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "view");
  if (auth instanceof NextResponse) return auth;

  try {
    const now = getKyivYearMonth();
    const year = Number(req.nextUrl.searchParams.get("year") || now.year);
    const month = Number(req.nextUrl.searchParams.get("month") || now.month);
    const q = String(req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const hair = parseHair(req.nextUrl.searchParams.get("hair"));
    const storageId = String(req.nextUrl.searchParams.get("storageId") || "");
    const category = String(req.nextUrl.searchParams.get("category") || "");
    const includeZero = req.nextUrl.searchParams.get("includeZero") === "1";
    const sort = parseSort(req.nextUrl.searchParams.get("sort"));
    const orderParam = req.nextUrl.searchParams.get("order");
    const order: "asc" | "desc" =
      orderParam === "asc" || orderParam === "desc"
        ? orderParam
        : sort === "qty" || sort === "value"
          ? "desc"
          : "asc";

    const periodYear = Number.isFinite(year) && year > 2000 ? year : now.year;
    const periodMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.month;

    const [balance, storages, view] = await Promise.all([
      getNativeWarehouseBalance(),
      prisma.warehouseStorage.findMany({
        where: { isActive: true },
        orderBy: { title: "asc" },
      }),
      queryWarehouseStockView({
        year: periodYear,
        month: periodMonth,
        q,
        hair,
        storageId,
        category,
        includeZero,
        sort,
        order,
      }),
    ]);

    const totals = view.stocks.reduce(
      (acc, row) => {
        acc.qty += row.quantity;
        acc.valueUah += row.valueUah;
        if (row.product.isHair) acc.hairUah += row.valueUah;
        return acc;
      },
      { qty: 0, valueUah: 0, hairUah: 0 },
    );

    return NextResponse.json({
      ok: true,
      period: {
        year: periodYear,
        month: periodMonth,
        isLive: view.isLive,
        snapshotMissing: view.snapshotMissing,
        snapshotCapturedAt: view.snapshotCapturedAt,
        lastSyncedAt: view.lastSyncedAt,
      },
      balance,
      filteredTotals: {
        rows: view.stocks.length,
        valueUah: Math.round(totals.valueUah * 100) / 100,
        hairUah: Math.round(totals.hairUah * 100) / 100,
      },
      storages,
      categories: view.categories,
      stocks: view.stocks,
    });
  } catch (err) {
    console.error("[api/admin/warehouse] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка завантаження складу" },
      { status: 500 },
    );
  }
}
