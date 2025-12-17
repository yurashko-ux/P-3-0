// web/app/api/admin/dashboard-layout/route.ts
// API для збереження/отримання layout дашбордів
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
 * Створює ключ для збереження layout дашборду
 */
function getLayoutKey(storageKey: string): string {
  return `dashboard:layout:${storageKey}`;
}

/**
 * GET: Отримати layout дашборду
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const storageKey = req.nextUrl.searchParams.get("storageKey") || "";

    if (!storageKey) {
      return NextResponse.json(
        { error: "storageKey is required" },
        { status: 400 },
      );
    }

    const key = getLayoutKey(storageKey);
    const rawValue = await kvRead.getRaw(key);

    if (rawValue === null) {
      return NextResponse.json({ layout: null });
    }

    let layout: any = null;
    try {
      layout = JSON.parse(rawValue);
    } catch {
      return NextResponse.json({ layout: null });
    }

    return NextResponse.json({ layout });
  } catch (error: any) {
    console.error("[admin/dashboard-layout] GET error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

/**
 * POST: Зберегти layout дашборду
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { storageKey, layout } = body;

    if (!storageKey) {
      return NextResponse.json(
        { error: "storageKey is required" },
        { status: 400 },
      );
    }

    if (!layout || !Array.isArray(layout)) {
      return NextResponse.json(
        { error: "layout must be an array" },
        { status: 400 },
      );
    }

    const key = getLayoutKey(storageKey);
    const valueToStore = JSON.stringify(layout);
    
    console.log(`[admin/dashboard-layout] 💾 Saving layout: key=${key}, blocks=${layout.length}`);
    
    await kvWrite.setRaw(key, valueToStore);
    console.log(`[admin/dashboard-layout] ✅ Layout saved successfully to KV`);

    // Перевіряємо, що дані збереглися
    const verifyValue = await kvRead.getRaw(key);
    console.log(`[admin/dashboard-layout] 🔍 Verification read after save:`, {
      hasValue: verifyValue !== null,
    });

    // Revalidate відповідні сторінки
    if (storageKey.includes("finance-report")) {
      revalidatePath("/admin/finance-report");
    }
    if (storageKey.includes("photo-reports")) {
      revalidatePath("/admin/photo-reports");
    }

    return NextResponse.json({
      success: true,
      storageKey,
      blocksCount: layout.length,
    });
  } catch (error: any) {
    console.error("[admin/dashboard-layout] POST error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}


