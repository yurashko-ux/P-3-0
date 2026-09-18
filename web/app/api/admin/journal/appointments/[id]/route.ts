import { NextRequest, NextResponse } from "next/server";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import {
  cancelAppointmentFromKresco,
  getSalonAppointment,
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
      participants: Array.isArray(body.participants) ? body.participants : undefined,
      goods: Array.isArray(body.goods) ? body.goods : undefined,
      actor: auth.type === "user" ? auth.login : auth.type,
    });
    return NextResponse.json({ ok: true, appointment });
  } catch (err) {
    console.error("[api/admin/journal/appointments/:id] PUT error:", err);
    const message = err instanceof Error ? err.message : "Помилка оновлення запису";
    const status = /вкажіть|оберіть|немає|не знайдено|потрібн/i.test(message) ? 400 : 500;
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
