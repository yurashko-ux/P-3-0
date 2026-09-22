import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import {
  createKrescoOnlyService,
  ensureCanonicalServicesSeeded,
  importSalonServicesFromAltegio,
  listSalonServices,
  updateSalonService,
} from "@/lib/journal/services";
import type { SalonServiceKind } from "@/lib/journal/kind";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    await ensureCanonicalServicesSeeded();
    const includeInactive = req.nextUrl.searchParams.get("all") === "1";
    const services = await listSalonServices(includeInactive);
    return NextResponse.json({ ok: true, services });
  } catch (err) {
    console.error("[api/admin/journal/services] GET error:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Помилка послуг" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === "create") {
      const service = await createKrescoOnlyService({
        title: String(body.title || ""),
        kind: String(body.kind || "other") as SalonServiceKind,
        durationSec: body.durationSec != null ? Number(body.durationSec) : body.durationMin != null ? Number(body.durationMin) * 60 : undefined,
        salePrice: body.salePrice != null ? Number(body.salePrice) : undefined,
      });
      return NextResponse.json({ ok: true, service });
    }

    if (body.action === "update" && body.id) {
      const service = await updateSalonService(String(body.id), {
        title: body.title != null ? String(body.title) : undefined,
        kind: body.kind != null ? (String(body.kind) as SalonServiceKind) : undefined,
        durationSec:
          body.durationSec != null
            ? Number(body.durationSec)
            : body.durationMin != null
              ? Number(body.durationMin) * 60
              : undefined,
        salePrice: body.salePrice != null ? Number(body.salePrice) : undefined,
        isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      });
      return NextResponse.json({ ok: true, service });
    }

    if (body.action === "kind" && body.id) {
      const service = await updateSalonService(String(body.id), {
        kind: String(body.kind) as SalonServiceKind,
      });
      return NextResponse.json({ ok: true, service });
    }

    // Оновлення повної ціни Kresco (mapped і kresco-only)
    if (body.action === "salePrice" && body.id) {
      const service = await updateSalonService(String(body.id), {
        salePrice: Number(body.salePrice) || 0,
      });
      return NextResponse.json({ ok: true, service });
    }

    // Імпорт: оновлення мапінгу + список незмаплених (без 1:1 дублів у каталозі)
    const result = await importSalonServicesFromAltegio();
    const services = await listSalonServices(true);
    return NextResponse.json({ ok: true, result, services });
  } catch (err) {
    console.error("[api/admin/journal/services] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка послуг";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
