// API підтвердження інкасації для фінзвіту.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getEncashmentConfirmationSummary,
  sendEncashmentForOwnerConfirmation,
} from "@/lib/finance/encashment-confirmation";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  return Boolean(envSecret && secret && envSecret === secret);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Невалідний year/month" }, { status: 400 });
  }

  try {
    const summary = await getEncashmentConfirmationSummary(year, month);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error("[admin/finance-report/encashment-confirmation] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Помилка завантаження" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const year = Number(body?.year);
    const month = Number(body?.month);
    const altegioIds = Array.isArray(body?.altegioIds)
      ? body.altegioIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0)
      : [];

    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "Невалідний year/month" }, { status: 400 });
    }

    if (altegioIds.length === 0) {
      return NextResponse.json({ error: "Оберіть хоча б один платіж" }, { status: 400 });
    }

    const result = await sendEncashmentForOwnerConfirmation({
      year,
      month,
      altegioIds,
      sentBy: "finance-report",
    });

    revalidatePath("/admin/finance-report");

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[admin/finance-report/encashment-confirmation] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Помилка відправки" },
      { status: 500 },
    );
  }
}
