// web/app/api/admin/finance-report/debug/route.ts
// Debug endpoint для перевірки збережених значень собівартості
// Захищено CRON_SECRET

import { NextRequest, NextResponse } from "next/server";
import { kvRead } from "@/lib/kv";

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
 * GET: Отримати всі збережені значення собівартості або конкретне значення
 * 
 * Query params:
 * - secret: CRON_SECRET (обов'язково)
 * - year: рік (опціонально, для конкретного значення)
 * - month: місяць (опціонально, для конкретного значення)
 * 
 * Якщо year та month не вказані, повертає список останніх 12 місяців
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const yearParam = req.nextUrl.searchParams.get("year");
    const monthParam = req.nextUrl.searchParams.get("month");

    // Якщо вказані year та month, повертаємо конкретне значення
    if (yearParam && monthParam) {
      const year = parseInt(yearParam, 10);
      const month = parseInt(monthParam, 10);

      if (!year || !month || month < 1 || month > 12) {
        return NextResponse.json(
          { error: "Invalid year or month" },
          { status: 400 },
        );
      }

      const key = getCostKey(year, month);
      const rawValue = await kvRead.getRaw(key);

      // kvGetRaw може повертати {"value":"..."} або просто "..."
      // Потрібно витягти значення з об'єкта, якщо воно там є
      let cost: number | null = null;
      if (rawValue !== null && typeof rawValue === "string") {
        try {
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
            } else {
              cost = parseFloat(String(value));
            }
          } else if (typeof parsed === "string") {
            cost = parseFloat(parsed);
          } else {
            cost = parseFloat(String(parsed));
          }
        } catch {
          cost = parseFloat(rawValue);
        }
      }

      return NextResponse.json({
        key,
        year,
        month,
        hasValue: rawValue !== null,
        rawValue: rawValue,
        parsedCost: Number.isFinite(cost) && cost >= 0 ? cost : null,
      });
    }

    // Якщо не вказані, повертаємо список останніх 12 місяців
    const today = new Date();
    const results: Array<{
      key: string;
      year: number;
      month: number;
      hasValue: boolean;
      rawValue: string | null;
      parsedCost: number | null;
    }> = [];

    for (let i = 0; i < 12; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      const key = getCostKey(year, month);
      const rawValue = await kvRead.getRaw(key);

      // kvGetRaw може повертати {"value":"..."} або просто "..."
      // Потрібно витягти значення з об'єкта, якщо воно там є
      let cost: number | null = null;
      if (rawValue !== null && typeof rawValue === "string") {
        try {
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
            } else {
              cost = parseFloat(String(value));
            }
          } else if (typeof parsed === "string") {
            cost = parseFloat(parsed);
          } else {
            cost = parseFloat(String(parsed));
          }
        } catch {
          cost = parseFloat(rawValue);
        }
      }

      results.push({
        key,
        year,
        month,
        hasValue: rawValue !== null,
        rawValue: rawValue,
        parsedCost: Number.isFinite(cost) && cost >= 0 ? cost : null,
      });
    }

    return NextResponse.json({
      summary: {
        totalChecked: results.length,
        withValues: results.filter((r) => r.hasValue).length,
        withoutValues: results.filter((r) => !r.hasValue).length,
      },
      results,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/debug] GET error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

