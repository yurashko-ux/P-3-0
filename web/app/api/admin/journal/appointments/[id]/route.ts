import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import {
  cancelAppointmentFromKresco,
  getSalonAppointment,
  updateAppointmentAttendanceFromKresco,
  updateAppointmentFromKresco,
} from "@/lib/journal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const appointment = await getSalonAppointment(params.id);
    if (!appointment || appointment.status === "deleted") {
      return NextResponse.json({ ok: false, error: "Запис не знайдено" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, appointment });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка читання запису" },
      { status: 500 },
    );
  }
}

/** Швидка зміна лише attendance (попап календаря). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.attendance == null) {
      return NextResponse.json({ ok: false, error: "Вкажіть attendance" }, { status: 400 });
    }
    const appointment = await updateAppointmentAttendanceFromKresco({
      appointmentId: params.id,
      attendance: Number(body.attendance),
      actor: auth.type === "user" ? auth.login : auth.type,
    });
    return NextResponse.json({ ok: true, appointment });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id] PATCH error:", err);
    const message = err instanceof Error ? err.message : "Помилка зміни статусу";
    const status = /немає|не знайдено|некоректн/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const appointment = await updateAppointmentFromKresco({
      appointmentId: params.id,
      directClientId: String(body.directClientId || ""),
      masterId: String(body.masterId || ""),
      datetime: String(body.datetime || ""),
      seanceLength: body.seanceLength != null ? Number(body.seanceLength) : undefined,
      comment: typeof body.comment === "string" ? body.comment : "",
      attendance: body.attendance != null ? Number(body.attendance) : undefined,
      serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds.map(String) : [],
      serviceLines: Array.isArray(body.serviceLines) ? body.serviceLines : undefined,
      participants: Array.isArray(body.participants) ? body.participants : undefined,
      goods: Array.isArray(body.goods) ? body.goods : undefined,
      actor: auth.type === "user" ? auth.login : auth.type,
    });
    return NextResponse.json({ ok: true, appointment });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id] PUT error:", err);
    const message = err instanceof Error ? err.message : "Помилка оновлення запису";
    const status = /вкажіть|оберіть|немає|не знайдено|потрібн|має бути/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireJournalSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const appointment = await cancelAppointmentFromKresco(
      params.id,
      auth.type === "user" ? auth.login : auth.type,
    );
    return NextResponse.json({ ok: true, appointment });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Помилка скасування запису";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
