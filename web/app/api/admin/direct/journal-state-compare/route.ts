// Тіньова звірка: поля картки Direct проти розрахунку з журналу Kresco. Лише читання.

import { NextRequest, NextResponse } from "next/server";
import { compareDirectWithJournal } from "@/lib/direct-journal-state";
import { isDirectAdminAuthorizedAsync } from "@/lib/direct-admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await isDirectAdminAuthorizedAsync(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const days = Number(req.nextUrl.searchParams.get("days")) || 60;
  try {
    return NextResponse.json({ ok: true, ...(await compareDirectWithJournal(Math.min(days, 365))) });
  } catch (err) {
    console.error("[api/admin/direct/journal-state-compare] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка звірки" },
      { status: 500 },
    );
  }
}
