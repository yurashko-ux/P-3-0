// web/app/api/admin/finance-report/exchange-rate/route.ts
// API для збереження/отримання курсу долара за місяць/рік
// Захищено CRON_SECRET

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { kvWrite, kvRead } from "@/lib/kv";

export const dynamic = "force-dynamic";

/**
 * Перевіряє, чи запит дозволений (тільки з CRON_SECRET)
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  return envSecret && secret && envSecret === secret;
}

/**
 * Створює ключ для збереження курсу долара за місяць/рік
 */
function getExchangeRateKey(year: number, month: number): string {
  return `finance:exchange-rate:usd:${year}:${month}`;
}

/**
 * GET: Отримати курс долара за місяць/рік
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const year = parseInt(req.nextUrl.searchParams.get("year") || "0", 10);
    const month = parseInt(req.nextUrl.searchParams.get("month") || "0", 10);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid year or month" },
        { status: 400 },
      );
    }

    const key = getExchangeRateKey(year, month);
    const rawValue = await kvRead.getRaw(key);

    if (rawValue === null) {
      return NextResponse.json({ rate: null });
    }

    let rate: number | null = null;
    try {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === "number") {
        rate = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        const val = (parsed as any).value ?? parsed;
        if (typeof val === "number") {
          rate = val;
        } else if (typeof val === "string") {
          rate = parseFloat(val);
        }
      } else if (typeof parsed === "string") {
        rate = parseFloat(parsed);
      }
    } catch {
      rate = parseFloat(rawValue);
    }

    return NextResponse.json({
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/exchange-rate] GET error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/**
 * POST: Зберегти курс долара за місяць/рік
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { year, month, rate } = body;

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid year or month" },
        { status: 400 },
      );
    }

    if (rate === undefined || rate === null) {
      return NextResponse.json(
        { error: "Rate is required" },
        { status: 400 },
      );
    }

    const rateNum = typeof rate === "number" ? rate : parseFloat(String(rate));

    if (!Number.isFinite(rateNum) || rateNum <= 0) {
      return NextResponse.json(
        { error: "Rate must be a positive number" },
        { status: 400 },
      );
    }

    const key = getExchangeRateKey(year, month);
    const valueToStore = JSON.stringify(rateNum);
    
    console.log(`[admin/finance-report/exchange-rate] 💾 Saving: key=${key}, rate=${rateNum}, year=${year}, month=${month}`);
    
    await kvWrite.setRaw(key, valueToStore);
    console.log(`[admin/finance-report/exchange-rate] ✅ Exchange rate saved successfully to KV`);

    revalidatePath("/admin/finance-report");

    return NextResponse.json({
      success: true,
      year,
      month,
      rate: rateNum,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/exchange-rate] POST error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
