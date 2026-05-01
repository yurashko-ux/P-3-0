// web/app/api/admin/finance-report/warehouse-balance/route.ts
// API для збереження/отримання ручно введеного балансу складу за місяць/рік
// Захищено CRON_SECRET

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { kvWrite, kvRead } from "@/lib/kv";
import { getPreviousMonth } from "@/lib/finance/warehouse-balance";

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
 * Створює ключ для збереження балансу складу за місяць/рік
 */
function getWarehouseBalanceKey(year: number, month: number): string {
  return `finance:warehouse:balance:${year}:${month}`;
}

/** Розбір значення з KV (узгоджено з readLegacyManualWarehouseBalance). */
function parseBalanceFromKvRaw(rawValue: string | null): number | null {
  if (rawValue === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (typeof parsed === "number") {
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    if (typeof parsed === "object" && parsed !== null) {
      const value = (parsed as { value?: unknown }).value ?? parsed;
      if (typeof value === "number") {
        return Number.isFinite(value) && value >= 0 ? value : null;
      }
      if (typeof value === "string") {
        const n = parseFloat(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
      }
    }
    if (typeof parsed === "string") {
      const n = parseFloat(parsed);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
  } catch {
    const n = parseFloat(rawValue);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

/**
 * GET: Отримати баланс складу за місяць/рік
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

    const key = getWarehouseBalanceKey(year, month);
    const rawValue = await kvRead.getRaw(key);
    const balance = parseBalanceFromKvRaw(rawValue);

    return NextResponse.json({
      balance,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/warehouse-balance] GET error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/**
 * POST: Зберегти баланс складу за місяць/рік
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { year, month, balance, copyFromPreviousMonth } = body;

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid year or month" },
        { status: 400 },
      );
    }

    /** Копіює ручний баланс з попереднього місяця (наприклад, якір 31.03 → старт для 30.04). */
    if (copyFromPreviousMonth === true) {
      const prev = getPreviousMonth(year, month);
      const prevKey = getWarehouseBalanceKey(prev.year, prev.month);
      const prevRaw = await kvRead.getRaw(prevKey);
      const prevBalance = parseBalanceFromKvRaw(prevRaw);
      if (prevBalance === null) {
        console.warn(
          `[admin/finance-report/warehouse-balance] copyFromPreviousMonth: у KV немає балансу за ${prev.year}-${prev.month}`,
        );
        return NextResponse.json(
          {
            error: `У попередньому місяці (${prev.month}.${prev.year}) немає збереженого балансу в KV. Спочатку збережіть його.`,
          },
          { status: 400 },
        );
      }
      const key = getWarehouseBalanceKey(year, month);
      await kvWrite.setRaw(key, JSON.stringify(prevBalance));
      console.log(
        `[admin/finance-report/warehouse-balance] Скопійовано баланс з ${prevKey} → ${key}: ${prevBalance} грн.`,
      );
      revalidatePath("/admin/finance-report");
      return NextResponse.json({
        success: true,
        year,
        month,
        balance: prevBalance,
        copiedFromYear: prev.year,
        copiedFromMonth: prev.month,
      });
    }

    if (balance === undefined || balance === null) {
      return NextResponse.json(
        { error: "Balance is required" },
        { status: 400 },
      );
    }

    const balanceValue = typeof balance === "number" ? balance : parseFloat(String(balance));

    if (!Number.isFinite(balanceValue) || balanceValue < 0) {
      return NextResponse.json(
        { error: "Balance must be a non-negative number" },
        { status: 400 },
      );
    }

    const key = getWarehouseBalanceKey(year, month);
    // Зберігаємо як JSON рядок
    console.log(`[admin/finance-report/warehouse-balance] 💾 Saving balance: key=${key}, value=${balanceValue}, year=${year}, month=${month}`);
    
    const valueToStore = JSON.stringify(balanceValue);
    console.log(`[admin/finance-report/warehouse-balance] Value to store (JSON): ${valueToStore}`);
    
    await kvWrite.setRaw(key, valueToStore);
    console.log(`[admin/finance-report/warehouse-balance] ✅ Balance saved successfully to KV`);

    // Перевіряємо, що дані збереглися (читаємо одразу після запису)
    const verifyValue = await kvRead.getRaw(key);
    console.log(`[admin/finance-report/warehouse-balance] 🔍 Verification read after save:`, {
      hasValue: verifyValue !== null,
      valueType: typeof verifyValue,
      value: verifyValue,
      valuePreview: verifyValue ? String(verifyValue).slice(0, 100) : null,
    });

    // Оновлюємо кеш сторінки фінансового звіту
    revalidatePath("/admin/finance-report");
    console.log(`[admin/finance-report/warehouse-balance] 🔄 Cache invalidated for /admin/finance-report`);

    return NextResponse.json({
      success: true,
      year,
      month,
      balance: balanceValue,
    });
  } catch (error: any) {
    console.error("[admin/finance-report/warehouse-balance] POST error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}
