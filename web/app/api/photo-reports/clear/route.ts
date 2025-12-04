// web/app/api/photo-reports/clear/route.ts
// API endpoint для очищення всіх фото-звітів

import { NextRequest, NextResponse } from "next/server";
import { clearAllPhotoReports } from "@/lib/photo-reports/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Перевіряє, чи запит дозволений (тільки з секретом)
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  return envSecret && secret && envSecret === secret;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 403 }
      );
    }

    const deletedCount = await clearAllPhotoReports();

    return NextResponse.json({
      ok: true,
      deletedCount,
      message: `Очищено ${deletedCount} фото-звітів`,
    });
  } catch (error) {
    console.error("[photo-reports/clear] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

