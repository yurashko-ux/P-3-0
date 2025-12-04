// web/app/api/admin/finance-report/cost/route.ts
// API для збереження/отримання ручно введеної собівартості товарів за місяць/рік
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
 * Створює ключ для збереження собівартості за місяць/рік
 */
function getCostKey(year: number, month: number): string {
  return `finance:goods:cost:${year}:${month}`;
}

/**
 * GET: Отримати собівартість за місяць/рік
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

    const key = getCostKey(year, month);
    const rawValue = await kvRead.getRaw(key);

    if (rawValue === null) {
      return NextResponse.json({ cost: null });
    }

    // kvGetRaw може повертати {"value":"..."} або просто "..."
    // Потрібно витягти значення з об'єкта, якщо воно там є
    let cost: number | null = null;
    try {
      // Спробуємо розпарсити як JSON
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === "number") {
        cost = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        // Якщо це об'єкт, шукаємо value всередині
        const value = (parsed as any).value ?? parsed;
        if (typeof value === "number") {
          cost = value;
        } else if (typeof value === "string") {
          cost = parseFloat(value);
        }
      } else if (typeof parsed === "string") {
        cost = parseFloat(parsed);
      }
    } catch {
      // Якщо не JSON, пробуємо як число
      cost = parseFloat(rawValue);
    }

    return NextResponse.json({
      cost: Number.isFinite(cost) && cost >= 0 ? cost : null,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/cost] GET error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/**
 * POST: Зберегти собівартість за місяць/рік
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { year, month, cost } = body;

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid year or month" },
        { status: 400 },
      );
    }

    if (cost === undefined || cost === null) {
      return NextResponse.json(
        { error: "Cost is required" },
        { status: 400 },
      );
    }

    const costValue = typeof cost === "number" ? cost : parseFloat(String(cost));

    if (!Number.isFinite(costValue) || costValue < 0) {
      return NextResponse.json(
        { error: "Cost must be a non-negative number" },
        { status: 400 },
      );
    }

    const key = getCostKey(year, month);
    // Зберігаємо як JSON рядок
    console.log(`[admin/finance-report/cost] 💾 Saving cost: key=${key}, value=${costValue}, year=${year}, month=${month}`);
    
    const valueToStore = JSON.stringify(costValue);
    console.log(`[admin/finance-report/cost] Value to store (JSON): ${valueToStore}`);
    
    await kvWrite.setRaw(key, valueToStore);
    console.log(`[admin/finance-report/cost] ✅ Cost saved successfully to KV`);

    // Перевіряємо, що дані збереглися (читаємо одразу після запису)
    const verifyValue = await kvRead.getRaw(key);
    console.log(`[admin/finance-report/cost] 🔍 Verification read after save:`, {
      hasValue: verifyValue !== null,
      valueType: typeof verifyValue,
      value: verifyValue,
      valuePreview: verifyValue ? String(verifyValue).slice(0, 100) : null,
    });

    // Оновлюємо кеш сторінки фінансового звіту
    revalidatePath("/admin/finance-report");
    console.log(`[admin/finance-report/cost] 🔄 Cache invalidated for /admin/finance-report`);

    return NextResponse.json({
      success: true,
      year,
      month,
      cost: costValue,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/cost] POST error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
