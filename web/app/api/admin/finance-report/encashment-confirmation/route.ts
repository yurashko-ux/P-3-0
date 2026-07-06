// API підтвердження інкасації для фінзвіту.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getEncashmentConfirmationSummary,
  revokeEncashmentConfirmation,
  sendEncashmentForOwnerConfirmation,
} from "@/lib/finance/encashment-confirmation";
import { requireFinanceReportAccess, resolveCanRevokeEncashment } from "@/lib/finance/require-finance-report-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFinanceReportAccess(req, "view");
  if (auth instanceof NextResponse) return auth;

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
  const auth = await requireFinanceReportAccess(req, "edit");
  if (auth instanceof NextResponse) return auth;

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

    const sentBy =
      auth.type === "user" ? auth.userName || auth.login : "finance-report";

    const result = await sendEncashmentForOwnerConfirmation({
      year,
      month,
      altegioIds,
      sentBy,
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

export async function DELETE(req: NextRequest) {
  const auth = await requireFinanceReportAccess(req, "edit");
  if (auth instanceof NextResponse) return auth;

  const canRevoke = await resolveCanRevokeEncashment({
    host: req.headers.get("host") || "",
    cookieHeader: req.headers.get("cookie") || "",
    auth,
  });
  if (!canRevoke) {
    return NextResponse.json(
      { error: "Скасувати підтвердження може лише розробник" },
      { status: 403 },
    );
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

    const result = await revokeEncashmentConfirmation({ year, month, altegioIds });

    revalidatePath("/admin/finance-report");

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[admin/finance-report/encashment-confirmation] DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Помилка скасування" },
      { status: 500 },
    );
  }
}
