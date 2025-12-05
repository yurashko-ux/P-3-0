// web/app/api/admin/finance-report/expense-field/route.ts
// API для збереження/отримання ручних полів витрат за місяць/рік
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
 * Створює ключ для збереження поля витрат за місяць/рік
 */
function getExpenseFieldKey(year: number, month: number, fieldKey: string): string {
  return `finance:expenses:${fieldKey}:${year}:${month}`;
}

/**
 * GET: Отримати значення поля витрат за місяць/рік
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const year = parseInt(req.nextUrl.searchParams.get("year") || "0", 10);
    const month = parseInt(req.nextUrl.searchParams.get("month") || "0", 10);
    const fieldKey = req.nextUrl.searchParams.get("field") || "";

    if (!year || !month || month < 1 || month > 12 || !fieldKey) {
      return NextResponse.json(
        { error: "Invalid year, month, or field" },
        { status: 400 },
      );
    }

    const key = getExpenseFieldKey(year, month, fieldKey);
    const rawValue = await kvRead.getRaw(key);

    if (rawValue === null) {
      return NextResponse.json({ value: null });
    }

    let value: number | null = null;
    try {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === "number") {
        value = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        const val = (parsed as any).value ?? parsed;
        if (typeof val === "number") {
          value = val;
        } else if (typeof val === "string") {
          value = parseFloat(val);
        }
      } else if (typeof parsed === "string") {
        value = parseFloat(parsed);
      }
    } catch {
      value = parseFloat(rawValue);
    }

    return NextResponse.json({
      value: Number.isFinite(value) && value >= 0 ? value : null,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/expense-field] GET error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/**
 * POST: Зберегти значення поля витрат за місяць/рік
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { year, month, fieldKey, value } = body;

    if (!year || !month || month < 1 || month > 12 || !fieldKey) {
      return NextResponse.json(
        { error: "Invalid year, month, or fieldKey" },
        { status: 400 },
      );
    }

    if (value === undefined || value === null) {
      return NextResponse.json(
        { error: "Value is required" },
        { status: 400 },
      );
    }

    const valueNum = typeof value === "number" ? value : parseFloat(String(value));

    if (!Number.isFinite(valueNum) || valueNum < 0) {
      return NextResponse.json(
        { error: "Value must be a non-negative number" },
        { status: 400 },
      );
    }

    const key = getExpenseFieldKey(year, month, fieldKey);
    const valueToStore = JSON.stringify(valueNum);
    
    console.log(`[admin/finance-report/expense-field] 💾 Saving: key=${key}, value=${valueNum}, fieldKey=${fieldKey}, year=${year}, month=${month}`);
    
    await kvWrite.setRaw(key, valueToStore);
    console.log(`[admin/finance-report/expense-field] ✅ Field saved successfully to KV`);

    // Перевіряємо, що дані збереглися
    const verifyValue = await kvRead.getRaw(key);
    console.log(`[admin/finance-report/expense-field] 🔍 Verification read after save:`, {
      hasValue: verifyValue !== null,
      valueType: typeof verifyValue,
      value: verifyValue,
    });

    revalidatePath("/admin/finance-report");

    return NextResponse.json({
      success: true,
      year,
      month,
      fieldKey,
      value: valueNum,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/expense-field] POST error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
