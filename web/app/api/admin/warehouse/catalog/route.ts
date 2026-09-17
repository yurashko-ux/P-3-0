import { NextRequest, NextResponse } from "next/server";
import { requireWarehouseSection } from "@/lib/warehouse/require-warehouse-auth";
import {
  createCatalogProduct,
  createWarehouseGroup,
  listWarehouseCatalog,
  listWarehouseGroups,
  searchWarehouseProducts,
} from "@/lib/warehouse/catalog";
import { mergeHairTailsIntoKhvosty } from "@/lib/warehouse/merge-khvosty";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "view");
  if (auth instanceof NextResponse) return auth;

  try {
    const search = String(req.nextUrl.searchParams.get("search") || "").trim();
    if (search) {
      const products = await searchWarehouseProducts(search);
      return NextResponse.json({ ok: true, products });
    }
    const [groups, products] = await Promise.all([
      listWarehouseGroups(),
      listWarehouseCatalog({
        q: String(req.nextUrl.searchParams.get("q") || ""),
        groupId: String(req.nextUrl.searchParams.get("groupId") || "") || undefined,
        hair: (req.nextUrl.searchParams.get("hair") as "all" | "yes" | "no") || "all",
      }),
    ]);
    return NextResponse.json({ ok: true, groups, products });
  } catch (err) {
    console.error("[api/admin/warehouse/catalog] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка каталогу" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireWarehouseSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const createdBy = auth.type === "user" ? auth.login : "superadmin";
    if (body.action === "merge-khvosty") {
      const result = await mergeHairTailsIntoKhvosty();
      return NextResponse.json({ ok: true, result });
    }
    if (body.action === "group") {
      const group = await createWarehouseGroup(String(body.title || ""), body.isHair === true);
      return NextResponse.json({ ok: true, group });
    }
    const product = await createCatalogProduct({
      title: String(body.title || ""),
      groupId: String(body.groupId || ""),
      lengthCm: body.lengthCm != null ? Number(body.lengthCm) : null,
      weightGrams: body.weightGrams != null ? Number(body.weightGrams) : null,
      isHair: body.isHair === true,
      costUsd: Number(body.costUsd) || 0,
      costUah: Number(body.costUah) || 0,
      createdBy,
    });
    return NextResponse.json({ ok: true, product });
  } catch (err) {
    console.error("[api/admin/warehouse/catalog] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка створення";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
