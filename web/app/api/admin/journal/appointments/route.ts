import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import {
  createAppointmentFromKresco,
  listAppointmentsForDay,
} from "@/lib/journal";
import { listJournalStaffFromAltegio, hasAssignedPosition, isCalendarColumn } from "@/lib/journal/staff";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const day = String(req.nextUrl.searchParams.get("day") || kyivCalendarTodayYmd());
    const { syncAppointmentsRangeFromAltegio } = await import("@/lib/journal");
    try {
      await syncAppointmentsRangeFromAltegio({ startDate: day, endDate: day, enrich: true });
    } catch (syncErr) {
      console.warn(
        "[api/admin/journal/appointments] Денна синхронізація Altegio не пройшла:",
        syncErr instanceof Error ? syncErr.message : syncErr,
      );
    }
    const [appointments, staffAll, services] = await Promise.all([
      listAppointmentsForDay(day),
      listJournalStaffFromAltegio(),
      prisma.salonService.findMany({
        where: { isActive: true },
        orderBy: [{ kind: "asc" }, { title: "asc" }],
      }),
    ]);
    const staffBase = staffAll.filter(hasAssignedPosition);
    const staffIds = staffBase.map((s) => s.altegioStaffId).filter((id) => id > 0);
    const teamRows =
      staffIds.length > 0
        ? await prisma.teamMember.findMany({
            where: { altegioStaffId: { in: staffIds }, isActive: true },
            select: { altegioStaffId: true, instagramUsername: true },
          })
        : [];
    const igByStaff = new Map<number, string | null>();
    for (const t of teamRows) {
      if (t.altegioStaffId != null) igByStaff.set(t.altegioStaffId, t.instagramUsername || null);
    }
    const staff = staffBase.map((s) => ({
      ...s,
      instagramUsername: igByStaff.get(s.altegioStaffId) || null,
    }));
    const masters = staff.filter(isCalendarColumn);

    // Лічильник «Не з'явився» для попапу (як у Altegio) — по всіх записах клієнта в Kresco.
    const clientIds = [
      ...new Set(
        appointments
          .map((a) => a.directClientId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const noShowByClient = new Map<string, number>();
    if (clientIds.length > 0) {
      const groups = await prisma.salonAppointment.groupBy({
        by: ["directClientId"],
        where: {
          directClientId: { in: clientIds },
          attendance: -1,
          status: { not: "deleted" },
        },
        _count: { _all: true },
      });
      for (const g of groups) {
        if (g.directClientId) noShowByClient.set(g.directClientId, g._count._all);
      }
    }
    const appointmentsWithStats = appointments.map((a) => {
      if (!a.directClient) return a;
      return {
        ...a,
        directClient: {
          ...a.directClient,
          noShowCount: noShowByClient.get(a.directClientId || "") ?? 0,
        },
      };
    });

    return NextResponse.json({
      ok: true,
      day,
      appointments: appointmentsWithStats,
      masters,
      staff,
      services,
    });
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
      serviceLines: Array.isArray(body.serviceLines) ? body.serviceLines : undefined,
      participants: Array.isArray(body.participants) ? body.participants : undefined,
      goods: Array.isArray(body.goods) ? body.goods : undefined,
      actor: auth.type === "user" ? auth.login : auth.type,
    });
    return NextResponse.json({ ok: true, appointment });
  } catch (err) {
    console.error("[api/admin/journal/appointments] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка створення запису";
    const status = /вкажіть|оберіть|немає|не знайдено|потрібн|має бути/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
