// web/app/api/admin/finance-report/expenses/route.ts
// API route для збереження/читання ручних витрат (захищений CRON_SECRET)

import { NextRequest, NextResponse } from "next/server";
import { kvWrite, kvRead } from "@/lib/kv";

const CRON_SECRET = process.env.CRON_SECRET?.trim();

function getExpensesKey(year: number, month: number): string {
  return `finance:expenses:${year}:${month}`;
}

// GET: Отримати витрати за місяць
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get("year") || "0");
    const month = parseInt(searchParams.get("month") || "0");
    const secret = searchParams.get("secret");

    if (!year || !month) {
      return NextResponse.json(
        { error: "year та month обов'язкові" },
        { status: 400 }
      );
    }

    // Перевірка секрету (опціонально для GET, але краще для безпеки)
    if (secret && secret !== CRON_SECRET) {
      return NextResponse.json({ error: "Невірний CRON_SECRET" }, { status: 403 });
    }

    const key = getExpensesKey(year, month);
    const raw = await kvRead.getRaw(key);

    console.log(`[expenses/route] GET key=${key}, hasValue=${!!raw}`);

    if (raw === null) {
      return NextResponse.json({ expenses: null });
    }

    // kvGetRaw повертає string | null, парсимо JSON
    let expensesValue: number | null = null;
    try {
      // Спробуємо розпарсити як JSON
      const parsed = JSON.parse(raw);
      if (typeof parsed === "number") {
        expensesValue = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        // Якщо це об'єкт, шукаємо value всередині
        const value = (parsed as any).value ?? parsed;
        if (typeof value === "number") {
          expensesValue = value;
        } else if (typeof value === "string") {
          expensesValue = parseFloat(value);
        }
      } else if (typeof parsed === "string") {
        expensesValue = parseFloat(parsed);
      }
    } catch {
      // Якщо не JSON, пробуємо як число
      expensesValue = parseFloat(raw);
    }

    if (expensesValue === null || !Number.isFinite(expensesValue) || expensesValue < 0) {
      console.log(`[expenses/route] Invalid expenses value:`, expensesValue);
      return NextResponse.json({ expenses: null });
    }

    console.log(`[expenses/route] ✅ Returning expenses:`, expensesValue);
    return NextResponse.json({ expenses: expensesValue });
  } catch (err: any) {
    console.error(`[expenses/route] GET error:`, err);
    return NextResponse.json(
      { error: err?.message || "Помилка читання витрат" },
      { status: 500 }
    );
  }
}

// POST: Зберегти витрати за місяць
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");

    if (!secret || secret !== CRON_SECRET) {
      return NextResponse.json(
        { error: "Невірний або відсутній CRON_SECRET" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { year, month, expenses } = body;

    if (!year || !month || typeof expenses !== "number" || expenses < 0) {
      return NextResponse.json(
        { error: "year, month та expenses (невід'ємне число) обов'язкові" },
        { status: 400 }
      );
    }

    const key = getExpensesKey(year, month);
    const valueToStore = JSON.stringify(expenses);

    console.log(`[expenses/route] POST saving: key=${key}, expenses=${expenses}`);

    await kvWrite.setRaw(key, valueToStore);

    // Перевіряємо, що збереглося
    const verify = await kvRead.getRaw(key);
    console.log(`[expenses/route] POST verify read:`, verify);

    return NextResponse.json({
      success: true,
      year,
      month,
      expenses,
      key,
    });
  } catch (err: any) {
    console.error(`[expenses/route] POST error:`, err);
    return NextResponse.json(
      { error: err?.message || "Помилка збереження витрат" },
      { status: 500 }
    );
  }
}
