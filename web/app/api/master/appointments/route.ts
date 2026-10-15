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

const KYIV_TZ = "Europe/Kyiv";
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function readInitData(req: NextRequest): string | null {
  const header = req.headers.get("x-telegram-init-data");
  if (header) return header;
  return req.nextUrl.searchParams.get("initData");
}

/** +/- N календарних днів у Europe/Kyiv (стійко до DST/півночі). */
function shiftYmd(ymd: string, deltaDays: number): string {
  const anchor = new Date(`${ymd}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(anchor);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

/** Понеділок..неділя (7 днів YYYY-MM-DD) того тижня (Europe/Kyiv), що містить anchorDay. */
function kyivWeekDays(anchorDay: string): string[] {
  const anchor = new Date(`${anchorDay}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, weekday: "short" }).format(anchor);
  const idx = Math.max(0, WEEKDAY_ORDER.indexOf(label));
  const monday = shiftYmd(anchorDay, -idx);
  return Array.from({ length: 7 }, (_, i) => shiftYmd(monday, i));
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
        hiddenAt: null,
      },
      select: { id: true, name: true, altegioStaffId: true, salonRole: true },
    });
    const isAdmin = member?.salonRole === "admin";
    // Адмін бачить усіх майстрів — не потребує власного altegioStaffId.
    if (!member || (!isAdmin && !member.altegioStaffId)) {
      return NextResponse.json(
        { ok: false, error: "Акаунт не прив'язано. Зверніться до адміністратора." },
        { status: 403 },
      );
    }

    const day = String(req.nextUrl.searchParams.get("day") || kyivCalendarTodayYmd());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ ok: false, error: "Некоректний день" }, { status: 400 });
    }
    const includeWeek = req.nextUrl.searchParams.get("week") === "1";

    // Altegio-синк пише майстра лише в altegioStaffId на самому записі (dual-write);
    // participants заповнюються лише для записів, створених вручну через Kresco.
    // Перевіряємо обидва джерела, щоб не втратити звичайні Altegio-записи.
    // Адмін (salonRole === "admin") бачить усі записи без фільтра по майстру.
    const isMine = (a: { altegioStaffId: number | null; participants: Array<{ altegioStaffId: number }> }) =>
      isAdmin ||
      a.altegioStaffId === member.altegioStaffId ||
      a.participants.some((p) => p.altegioStaffId === member.altegioStaffId);

    const appointments = await listAppointmentsForDay(day);
    const mine = appointments.filter(isMine);

    let weekDays: Array<{ day: string; count: number }> | undefined;
    if (includeWeek) {
      const week = kyivWeekDays(day);
      weekDays = await Promise.all(
        week.map(async (d) => {
          if (d === day) return { day: d, count: mine.length };
          const dayAppointments = await listAppointmentsForDay(d);
          return { day: d, count: dayAppointments.filter(isMine).length };
        }),
      );
    }

    const rows = mine.map((a) => ({
      id: a.id,
      datetime: a.datetime.toISOString(),
      seanceLength: a.seanceLength,
      attendance: normalizeAttendance(a.attendance),
      clientName: a.clientName || a.directClient?.firstName || null,
      clientPhone: a.clientPhone || a.directClient?.phone || null,
      staffName: isAdmin ? a.staffName || a.master?.name || null : null,
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
      isAdmin,
      appointments: rows,
      ...(weekDays ? { weekDays } : {}),
    });
  } catch (error) {
    console.error("[api/master/appointments] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка завантаження журналу" },
      { status: 500 },
    );
  }
}
