import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { syncJournalAppointmentsFromAltegio } from "@/lib/journal";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await syncJournalAppointmentsFromAltegio();
    console.log("[api/admin/journal/sync] Готово", result);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/admin/journal/sync] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка синхронізації журналу" },
      { status: 500 },
    );
  }
}
