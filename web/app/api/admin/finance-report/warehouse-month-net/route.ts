// web/app/api/admin/finance-report/warehouse-month-net/route.ts
// Підписана місяцева зміна складу (грн) для rollforward від ручного якоря попереднього місяця.
// Захищено CRON_SECRET

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { kvWrite, kvRead } from "@/lib/kv";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  return Boolean(envSecret && secret && envSecret === secret);
}

function getKey(year: number, month: number): string {
  return `finance:warehouse:month_net_change:${year}:${month}`;
}

function parseSigned(rawValue: string): number | null {
  try {
    const parsed = JSON.parse(rawValue);
    const value = (parsed as { value?: unknown })?.value ?? parsed;
    const numValue = typeof value === "number" ? value : parseFloat(String(value));
    return Number.isFinite(numValue) ? numValue : null;
  } catch {
    const numValue = parseFloat(rawValue);
    return Number.isFinite(numValue) ? numValue : null;
  }
}

/**
 * GET: поточне значення month_net_change (null якщо ключа немає)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const year = parseInt(req.nextUrl.searchParams.get("year") || "0", 10);
    const month = parseInt(req.nextUrl.searchParams.get("month") || "0", 10);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
    }

    const rawValue = await kvRead.getRaw(getKey(year, month));
    if (rawValue === null || typeof rawValue !== "string") {
      return NextResponse.json({ value: null });
    }

    const value = parseSigned(rawValue);
    return NextResponse.json({ value: value !== null ? value : null });
  } catch (error: unknown) {
    console.error("[admin/finance-report/warehouse-month-net] GET error:", error);
    return NextResponse.json(
      { error: String(error instanceof Error ? error.message : error) },
      { status: 500 },
    );
  }
}

/**
 * POST: зберегти підписане значення (грн)
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { year, month, value } = body;

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
    }

    if (value === undefined || value === null) {
      return NextResponse.json({ error: "Value is required" }, { status: 400 });
    }

    const valueNum = typeof value === "number" ? value : parseFloat(String(value));

    if (!Number.isFinite(valueNum)) {
      return NextResponse.json({ error: "Value must be a finite number" }, { status: 400 });
    }

    const key = getKey(year, month);
    await kvWrite.setRaw(key, JSON.stringify(valueNum));
    console.log(`[admin/finance-report/warehouse-month-net] Збережено ${key} = ${valueNum} грн`);

    revalidatePath("/admin/finance-report");

    return NextResponse.json({
      success: true,
      year,
      month,
      value: valueNum,
    });
  } catch (error: unknown) {
    console.error("[admin/finance-report/warehouse-month-net] POST error:", error);
    return NextResponse.json(
      { error: String(error instanceof Error ? error.message : error) },
      { status: 500 },
    );
  }
}
