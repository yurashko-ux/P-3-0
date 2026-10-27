import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { loadWorkSchedule, saveWorkSchedule, slotsForShift } from "@/lib/journal/work-schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function monthBounds(month: string): { from: string; to: string } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) return null;
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(last).padStart(2, "0")}`,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  const bounds = monthBounds(req.nextUrl.searchParams.get("month") || "");
  if (!bounds) {
    return NextResponse.json({ ok: false, error: "Потрібен місяць у форматі YYYY-MM" }, { status: 400 });
  }
  try {
    const schedule = await loadWorkSchedule(bounds.from, bounds.to);
    return NextResponse.json({ ok: true, ...schedule });
  } catch (err) {
    console.error("[api/admin/journal/schedule] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка графіка" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const staffIds = Array.isArray(body?.staffIds) ? body.staffIds.map(Number).filter((id: number) => id > 0) : [];
    const dates = Array.isArray(body?.dates) ? body.dates.map(String) : [];
    const off = Boolean(body?.off);
    const from = String(body?.from || "");
    const to = String(body?.to || "");
    const breakFrom = String(body?.breakFrom || "");
    const breakTo = String(body?.breakTo || "");
    if (!off && (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || from >= to)) {
      return NextResponse.json({ ok: false, error: "Вкажіть робочий час" }, { status: 400 });
    }
    await saveWorkSchedule({
      staffIds,
      dates,
      off,
      slots: off ? undefined : slotsForShift(from, to, breakFrom || undefined, breakTo || undefined),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/journal/schedule] PUT error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Не вдалося зберегти графік" },
      { status: 500 },
    );
  }
}
