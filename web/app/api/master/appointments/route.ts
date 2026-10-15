// Записи одного майстра на день — лише читання, для Telegram Mini App /master.
// Авторизація через initData (Telegram WebApp), без admin-кук і без доступу до решти CRM.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listAppointmentsForDay } from "@/lib/journal";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { normalizeAttendance } from "@/lib/journal/attendance";
import { verifyTelegramWebAppInitData } from "@/lib/telegram/verify-webapp-init-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function readInitData(req: NextRequest): string | null {
  const header = req.headers.get("x-telegram-init-data");
  if (header) return header;
  return req.nextUrl.searchParams.get("initData");
}

export async function GET(req: NextRequest) {
  try {
    const initData = readInitData(req);
    const telegramUser = verifyTelegramWebAppInitData(initData);
    if (!telegramUser) {
      return NextResponse.json(
        { ok: false, error: "Відкрийте журнал через кнопку в Telegram-боті" },
        { status: 401 },
      );
    }

    const member = await prisma.teamMember.findFirst({
      where: {
        telegramChatId: BigInt(telegramUser.id),
        isActive: true,
        altegioStaffId: { not: null },
        hiddenAt: null,
      },
      select: { id: true, name: true, altegioStaffId: true },
    });
    if (!member || !member.altegioStaffId) {
      return NextResponse.json(
        { ok: false, error: "Акаунт не прив'язано. Зверніться до адміністратора." },
        { status: 403 },
      );
    }

    const day = String(req.nextUrl.searchParams.get("day") || kyivCalendarTodayYmd());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ ok: false, error: "Некоректний день" }, { status: 400 });
    }

    const appointments = await listAppointmentsForDay(day);
    // Altegio-синк пише майстра лише в altegioStaffId на самому записі (dual-write);
    // participants заповнюються лише для записів, створених вручну через Kresco.
    // Перевіряємо обидва джерела, щоб не втратити звичайні Altegio-записи.
    const mine = appointments.filter(
      (a) =>
        a.altegioStaffId === member.altegioStaffId ||
        a.participants.some((p) => p.altegioStaffId === member.altegioStaffId),
    );

    const rows = mine.map((a) => ({
      id: a.id,
      datetime: a.datetime.toISOString(),
      seanceLength: a.seanceLength,
      attendance: normalizeAttendance(a.attendance),
      clientName: a.clientName || a.directClient?.firstName || null,
      clientPhone: a.clientPhone || a.directClient?.phone || null,
      lines: a.lines.map((l) => ({ title: l.title })),
      directClient: a.directClient
        ? {
            id: a.directClient.id,
            firstName: a.directClient.firstName,
            lastName: a.directClient.lastName,
            visits: a.directClient.visits,
            lastVisitAt: a.directClient.lastVisitAt,
          }
        : null,
    }));

    return NextResponse.json({
      ok: true,
      day,
      masterName: member.name,
      appointments: rows,
    });
  } catch (error) {
    console.error("[api/master/appointments] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка завантаження журналу" },
      { status: 500 },
    );
  }
}
