// Налаштування часу щоденного звіту (Kyiv).

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { getTodayKyiv } from "@/lib/direct-stats-config";
import { kvRead, kvWrite } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAILY_REPORT_TIME = "13:30";
const DAILY_REPORT_SCHEDULE_KEY = "reports:daily:schedule:kyiv";
const DAILY_REPORT_LAST_RUN_KEY = "reports:daily:last-run";

function isAuthorized(
  req: NextRequest,
  auth: Awaited<ReturnType<typeof getAuthContext>>,
): boolean {
  const host = req.headers.get("host") || "";
  if (isPreviewDeploymentHost(host)) return true;
  if (!auth) return false;
  if (auth.type === "superadmin") return true;
  return auth.permissions.debugSection === "edit" || auth.permissions.debugSection === "view";
}

function parseDailyReportTime(raw: string | null | undefined) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getKyivNowLabel() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hours = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minutes = parts.find((p) => p.type === "minute")?.value ?? "00";
  return {
    nowKyiv: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    kyivDay: getTodayKyiv(),
    iso: now.toISOString(),
  };
}

async function readLastRun() {
  const raw = await kvRead.getRaw(DAILY_REPORT_LAST_RUN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!isAuthorized(req, auth)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const scheduleRaw = await kvRead.getRaw(DAILY_REPORT_SCHEDULE_KEY);
  const parsed = parseDailyReportTime(scheduleRaw);
  const schedule = parsed ?? DEFAULT_DAILY_REPORT_TIME;
  const now = getKyivNowLabel();
  const lastRun = await readLastRun();

  return NextResponse.json({
    ok: true,
    schedule,
    scheduleSource: parsed ? "kv" : "default",
    nowKyiv: now.nowKyiv,
    kyivDay: now.kyivDay,
    lastRun,
  });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!isAuthorized(req, auth)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const input = parseDailyReportTime(body?.time);
    if (!input) {
      return NextResponse.json(
        { ok: false, error: "Невірний формат часу. Очікується HH:MM" },
        { status: 400 },
      );
    }

    await kvWrite.setRaw(DAILY_REPORT_SCHEDULE_KEY, input);
    const now = getKyivNowLabel();
    const lastRun = await readLastRun();

    console.log("[admin/reports/daily-schedule] Оновлено час:", { schedule: input });

    return NextResponse.json({
      ok: true,
      schedule: input,
      scheduleSource: "kv",
      nowKyiv: now.nowKyiv,
      kyivDay: now.kyivDay,
      lastRun,
    });
  } catch (error) {
    console.error("[admin/reports/daily-schedule] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
