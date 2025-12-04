// web/app/api/admin/finance-report/test-kv/route.ts
// Тестовий endpoint для перевірки роботи KV збереження/читання
// Захищено CRON_SECRET

import { NextRequest, NextResponse } from "next/server";
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
 * GET: Тест збереження та читання з KV
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const testKey = "finance:test:kv:write-read";
  const testValue = `test-${Date.now()}`;

  try {
    // 1. Перевіряємо, чи є змінні середовища
    const hasKvUrl = !!(
      process.env.KV_REST_API_URL ||
      process.env.VERCEL_KV_REST_API_URL ||
      process.env.VERCEL_KV_URL ||
      process.env.KV_URL
    );
    const hasKvToken = !!(
      process.env.KV_REST_API_TOKEN ||
      process.env.VERCEL_KV_REST_API_TOKEN ||
      process.env.KV_REST_API_WRITE_ONLY_TOKEN ||
      process.env.KV_WRITE_ONLY_TOKEN ||
      process.env.KV_TOKEN
    );

    // 2. Спробуємо зберегти значення
    let saveResult: { success: boolean; error?: string } = { success: false };
    try {
      await kvWrite.setRaw(testKey, testValue);
      saveResult = { success: true };
    } catch (err: any) {
      saveResult = {
        success: false,
        error: err?.message || String(err),
      };
    }

    // 3. Спробуємо прочитати значення
    let readResult: {
      success: boolean;
      value: string | null;
      error?: string;
    } = { success: false, value: null };
    try {
      const readValue = await kvRead.getRaw(testKey);
      readResult = {
        success: true,
        value: readValue,
      };
    } catch (err: any) {
      readResult = {
        success: false,
        value: null,
        error: err?.message || String(err),
      };
    }

    // 4. Перевіряємо, чи значення збігається
    const valuesMatch = readResult.value === testValue;

    return NextResponse.json({
      env: {
        hasKvUrl,
        hasKvToken,
      },
      test: {
        key: testKey,
        savedValue: testValue,
        readValue: readResult.value,
        valuesMatch,
      },
      save: saveResult,
      read: readResult,
      conclusion: valuesMatch
        ? "✅ KV працює правильно - дані зберігаються та читаються"
        : "❌ KV не працює - дані не зберігаються або не читаються правильно",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: String(error?.message || error),
        stack: error?.stack,
      },
      { status: 500 },
    );
  }
}
