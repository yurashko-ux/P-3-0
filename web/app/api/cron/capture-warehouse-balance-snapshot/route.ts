import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getWarehouseBalance } from "@/lib/altegio";
import {
  getSnapshotTargetMonth,
  saveWarehouseBalanceSnapshot,
} from "@/lib/finance/warehouse-balance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || "";
  const authHeader = req.headers.get("authorization");
  const secretParam = req.nextUrl.searchParams.get("secret");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  return Boolean(
    isVercelCron ||
      (cronSecret && (authHeader === `Bearer ${cronSecret}` || secretParam === cronSecret)),
  );
}

function getMonthEndDate(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const forceYear = Number(req.nextUrl.searchParams.get("year") || 0);
    const forceMonth = Number(req.nextUrl.searchParams.get("month") || 0);
    const force = forceYear > 0 && forceMonth >= 1 && forceMonth <= 12;

    const target = getSnapshotTargetMonth();
    if (!force && !target.shouldCapture) {
      const payload = {
        ok: true,
        skipped: true,
        reason: "not_snapshot_time",
        kyivNow: target.kyivNow,
      };
      console.log("[cron/capture-warehouse-balance-snapshot] Пропуск запуску", payload);
      return NextResponse.json(payload);
    }

    const year = force ? forceYear : target.targetYear;
    const month = force ? forceMonth : target.targetMonth;
    const monthEndDate = getMonthEndDate(year, month);

    console.log("[cron/capture-warehouse-balance-snapshot] Старт snapshot", {
      year,
      month,
      monthEndDate,
      forced: force,
      kyivNow: target.kyivNow,
    });

    const totalBalance = await getWarehouseBalance({ date: monthEndDate });
    await saveWarehouseBalanceSnapshot({
      year,
      month,
      totalBalance,
      snapshotAt: new Date(),
    });
    revalidatePath("/admin/finance-report");

    const payload = {
      ok: true,
      year,
      month,
      monthEndDate,
      totalBalance,
      source: "goods_current_actual_amounts",
      forced: force,
    };
    console.log("[cron/capture-warehouse-balance-snapshot] Snapshot збережено", payload);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[cron/capture-warehouse-balance-snapshot] Помилка snapshot:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
