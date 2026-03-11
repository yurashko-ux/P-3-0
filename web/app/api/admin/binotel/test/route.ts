// web/app/api/admin/binotel/test/route.ts
// Тест з'єднання з Binotel API

import { NextRequest, NextResponse } from "next/server";
import { sendRequest, isBinotelSuccess } from "@/lib/binotel/client";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get("secret");
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const key = process.env.BINOTEL_API_KEY?.trim();
  const secret = process.env.BINOTEL_API_SECRET?.trim();

  if (!key || !secret) {
    return NextResponse.json({
      ok: false,
      error: "BINOTEL_API_KEY або BINOTEL_API_SECRET не налаштовані",
      envCheck: { hasKey: !!key, hasSecret: !!secret },
    });
  }

  try {
    const result = await sendRequest("settings/list-of-employees", {});

    if (isBinotelSuccess(result)) {
      const employees = (result as { listOfEmployees?: unknown }).listOfEmployees;
      return NextResponse.json({
        ok: true,
        message: "Binotel API доступний",
        employeesCount: Array.isArray(employees) ? employees.length : 0,
      });
    }

    const err = result as { code?: string; message?: string };
    return NextResponse.json({
      ok: false,
      error: "Binotel API помилка",
      code: err.code,
      message: err.message,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      error: "Помилка запиту до Binotel",
      details: msg,
    });
  }
}
