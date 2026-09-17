import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import {
  createAppointmentFromKresco,
  listAppointmentsForDay,
} from "@/lib/journal";
import { listJournalStaffFromAltegio, hasAssignedPosition, isCalendarMaster } from "@/lib/journal/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const day = String(req.nextUrl.searchParams.get("day") || kyivCalendarTodayYmd());
    const [appointments, staffAll, services] = await Promise.all([
      listAppointmentsForDay(day),
      listJournalStaffFromAltegio(),
      prisma.salonService.findMany({
        where: { isActive: true },
        orderBy: [{ kind: "asc" }, { title: "asc" }],
      }),
    ]);
    const staff = staffAll.filter(hasAssignedPosition);
    const masters = staff.filter(isCalendarMaster);
    return NextResponse.json({ ok: true, day, appointments, masters, staff, services });
  } catch (err) {
    console.error("[api/admin/journal/appointments] GET error:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Помилка журналу" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const appointment = await createAppointmentFromKresco({
      directClientId: String(body.directClientId || ""),
      masterId: String(body.masterId || ""),
      datetime: String(body.datetime || ""),
      seanceLength: body.seanceLength != null ? Number(body.seanceLength) : undefined,
      comment: typeof body.comment === "string" ? body.comment : "",
      attendance: body.attendance != null ? Number(body.attendance) : 0,
      serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds.map(String) : [],
    });
    return NextResponse.json({ ok: true, appointment });
  } catch (err) {
    console.error("[api/admin/journal/appointments] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка створення запису";
    const status = /вкажіть|оберіть|немає|не знайдено|потрібн/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
