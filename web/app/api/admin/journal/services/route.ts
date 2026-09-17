import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { importSalonServicesFromAltegio, listSalonServices, updateSalonServiceKind } from "@/lib/journal/services";
import type { SalonServiceKind } from "@/lib/journal/kind";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
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
    if (body.action === "kind" && body.id) {
      const service = await updateSalonServiceKind(String(body.id), String(body.kind) as SalonServiceKind);
      return NextResponse.json({ ok: true, service });
    }
    const result = await importSalonServicesFromAltegio();
    const services = await listSalonServices(true);
    return NextResponse.json({ ok: true, result, services });
  } catch (err) {
    console.error("[api/admin/journal/services] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка імпорту послуг";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
