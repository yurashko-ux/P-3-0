// Cron: щоденний операційний звіт у Telegram (після запланованого часу Kyiv, за вчора).
//
// Vercel викликає endpoint кожні 5 хв (*/5). Відправка — один раз на календарний день Kyiv,
// коли поточний час >= розкладу (вікно, не exact HH:MM — cron часто запізнюється на 1–3 хв).

import { NextRequest, NextResponse } from "next/server";
import { getPreviousKyivDay, getTodayKyiv } from "@/lib/direct-stats-config";
import { deliverDailyReport } from "@/lib/reports/delivery";
import { kvRead, kvWrite } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAILY_REPORT_TIME = "13:30";
const DAILY_REPORT_SCHEDULE_KEY = "reports:daily:schedule:kyiv";
const DAILY_REPORT_LAST_RUN_KEY = "reports:daily:last-run";
const DAILY_REPORT_CRON_LOG_KEY = "reports:daily:cron:log";

type DailyReportSchedule = {
  hours: number;
  minutes: number;
  label: string;
};

type DailyReportLastRun = {
  /** День, за який зібрано звіт (зазвичай вчора). */
  kyivDay: string;
  /** Календарний день Kyiv, коли cron реально відправив (для дедупу «раз на день»). */
  runKyivDay?: string;
  schedule: string;
  nowKyiv: string;
  at: string;
  ok: boolean;
  sent: number;
  failed: number;
  recipientCount: number;
  errors?: string[];
  via?: string;
};

function okCron(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const envSecret = process.env.CRON_SECRET || "";
  const urlSecret = req.nextUrl.searchParams.get("secret");
  if (envSecret && urlSecret && envSecret === urlSecret) return true;
  const authHeader = req.headers.get("authorization");
  if (envSecret && authHeader === `Bearer ${envSecret}`) return true;
  return false;
}

function parseDailyReportTime(raw: string | null | undefined): DailyReportSchedule | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return {
    hours,
    minutes,
    label: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
  };
}

function getKyivNow() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  // Деякі середовища віддають "24" опівночі — нормалізуємо до 0.
  let hours = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  if (hours === 24) hours = 0;
  const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const label = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return {
    kyivDay: getTodayKyiv(),
    hours,
    minutes,
    label,
    iso: now.toISOString(),
  };
}

function toDayMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

async function readLastRun(): Promise<DailyReportLastRun | null> {
  const raw = await kvRead.getRaw(DAILY_REPORT_LAST_RUN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DailyReportLastRun;
  } catch {
    return null;
  }
}

async function writeLastRun(payload: DailyReportLastRun) {
  await kvWrite.setRaw(DAILY_REPORT_LAST_RUN_KEY, JSON.stringify(payload));
}

async function appendCronLog(payload: DailyReportLastRun & { reason?: string }) {
  try {
    await kvWrite.lpush(DAILY_REPORT_CRON_LOG_KEY, JSON.stringify(payload));
    await kvWrite.ltrim(DAILY_REPORT_CRON_LOG_KEY, 0, 199);
  } catch (err) {
    console.warn("[cron/reports-daily] KV log failed:", err);
  }
}

/** Чи вже успішно відправили сьогодні (за runKyivDay; fallback на старі записи без поля). */
function wasAlreadySentToday(
  lastRun: DailyReportLastRun | null,
  nowKyivDay: string,
  scheduleLabel: string,
): boolean {
  if (!lastRun?.ok) return false;
  if (lastRun.runKyivDay) {
    return lastRun.runKyivDay === nowKyivDay;
  }
  // Сумісність зі старим форматом: kyivDay помилково зберігав день звіту (вчора),
  // тож дедуп за kyivDay===сьогодні майже ніколи не спрацьовував.
  return lastRun.kyivDay === nowKyivDay && lastRun.schedule === scheduleLabel;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  console.log("[cron/reports-daily] POST request received");

  if (!okCron(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const force = req.nextUrl.searchParams.get("force") === "1";
    const now = getKyivNow();
    const scheduleRaw = await kvRead.getRaw(DAILY_REPORT_SCHEDULE_KEY);
    const schedule =
      parseDailyReportTime(scheduleRaw) ?? parseDailyReportTime(DEFAULT_DAILY_REPORT_TIME);
    if (!schedule) {
      console.warn("[cron/reports-daily] Невалідний час розкладу:", scheduleRaw);
      return NextResponse.json(
        {
          ok: false,
          error: "Невалідний формат часу розкладу (очікується HH:MM).",
          scheduleRaw,
        },
        { status: 400 },
      );
    }

    const lastRun = await readLastRun();
    const alreadySent = wasAlreadySentToday(lastRun, now.kyivDay, schedule.label);
    const nowMins = toDayMinutes(now.hours, now.minutes);
    const scheduleMins = toDayMinutes(schedule.hours, schedule.minutes);
    // Вікно: будь-який тік cron після запланованого часу (не exact HH:MM).
    const isAtOrAfterSchedule = nowMins >= scheduleMins;

    if (!force && !isAtOrAfterSchedule) {
      const payload = {
        kyivDay: now.kyivDay,
        runKyivDay: now.kyivDay,
        schedule: schedule.label,
        nowKyiv: now.label,
        at: now.iso,
        ok: true,
        sent: 0,
        failed: 0,
        recipientCount: 0,
        via: "skip:not-time",
      } satisfies DailyReportLastRun;
      console.log("[cron/reports-daily] Пропуск — ще не час (вікно >= schedule):", {
        schedule: schedule.label,
        now: now.label,
        kyivDay: now.kyivDay,
      });
      await appendCronLog({ ...payload, reason: "not-time" });
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "not-time",
        schedule: schedule.label,
        nowKyiv: now.label,
        kyivDay: now.kyivDay,
        lastRun,
      });
    }

    if (!force && alreadySent) {
      console.log("[cron/reports-daily] Пропуск — вже відправлено сьогодні:", {
        schedule: schedule.label,
        kyivDay: now.kyivDay,
        lastRun,
      });
      await appendCronLog({
        kyivDay: now.kyivDay,
        runKyivDay: now.kyivDay,
        schedule: schedule.label,
        nowKyiv: now.label,
        at: now.iso,
        ok: true,
        sent: 0,
        failed: 0,
        recipientCount: 0,
        via: "skip:already-sent",
        reason: "already-sent",
      });
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already-sent",
        schedule: schedule.label,
        kyivDay: now.kyivDay,
        lastRun,
      });
    }

    const dayParam = req.nextUrl.searchParams.get("day");
    // Після часу розкладу звітуємо за завершений вчорашній день (еквайринг і зведення вже є).
    const reportKyivDay = dayParam ? getTodayKyiv(dayParam) : getPreviousKyivDay();
    const result = await deliverDailyReport({ kyivDay: reportKyivDay });

    const runPayload: DailyReportLastRun = {
      kyivDay: result.kyivDay,
      runKyivDay: now.kyivDay,
      schedule: schedule.label,
      nowKyiv: now.label,
      at: now.iso,
      ok: result.ok,
      sent: result.sent,
      failed: result.failed,
      recipientCount: result.recipientCount,
      errors: result.errors,
      via: req.headers.get("x-vercel-cron") === "1" ? "vercel" : "manual",
    };

    await writeLastRun(runPayload);
    await appendCronLog(runPayload);

    console.log("[cron/reports-daily] Done:", {
      reportKyivDay: result.kyivDay,
      runKyivDay: now.kyivDay,
      sent: result.sent,
      failed: result.failed,
      recipientCount: result.recipientCount,
      schedule: schedule.label,
      nowKyiv: now.label,
    });

    return NextResponse.json({
      ok: result.ok,
      kyivDay: result.kyivDay,
      runKyivDay: now.kyivDay,
      sent: result.sent,
      failed: result.failed,
      recipientCount: result.recipientCount,
      errors: result.errors,
      schedule: schedule.label,
      nowKyiv: now.label,
    });
  } catch (error) {
    console.error("[cron/reports-daily] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
