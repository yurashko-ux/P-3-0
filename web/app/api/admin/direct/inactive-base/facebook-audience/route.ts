// Завантаження активної бази у файл для кабінету Facebook.
// Лише розробник: пароль адміністратора, логін mykolay або посада «розробник».
// Прев’ю-хост, CRON і решта посад файлу не отримують.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-rbac";
import { isDeveloperActor } from "@/lib/finance/encashment-confirmation";
import { prisma } from "@/lib/prisma";
import { getTodayKyiv } from "@/lib/direct-stats-config";
import { enrichClientsDaysLikeDirect } from "@/lib/inactive-base/enrich-days-like-direct";
import { isActiveBaseOnKyivDay } from "@/lib/inactive-base/days-since-last-visit";
import { buildFacebookCustomerListCsv } from "@/lib/inactive-base/facebook-customer-list";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const PAID_VISIT_OR = [
  { paidServiceAttended: true },
  { paidServiceAttendanceValue: 1 },
  { paidRecordsInHistoryCount: { gt: 0 } },
  { spent: { gt: 0 } },
];

function denied(status: number, error: string): NextResponse {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } }
  );
}

async function requireDeveloper(req: NextRequest): Promise<true | NextResponse> {
  const auth = await getAuthContext(req);
  if (!auth) return denied(401, "Не авторизовано");
  if (!(await isDeveloperActor(auth))) {
    console.warn("[inactive-base/facebook-audience] Відхилено: не розробник");
    return denied(403, "Файл доступний лише розробнику");
  }
  return true;
}

/** Той самий відбір, що плитка «Активна»: Direct з Altegio id, 0–100 днів або майбутній платний запис. */
async function loadActiveBaseForExport(todayKyiv: string) {
  const raw = await prisma.directClient.findMany({
    where: {
      altegioClientId: { not: null },
      OR: [...PAID_VISIT_OR, { paidServiceDate: { not: null } }, { signedUpForPaidService: true }],
    },
    select: {
      id: true,
      altegioClientId: true,
      firstName: true,
      lastName: true,
      phone: true,
      spent: true,
      paidServiceAttended: true,
      paidServiceAttendanceValue: true,
      paidRecordsInHistoryCount: true,
      consultationAttended: true,
      consultationAttendanceValue: true,
      consultationDate: true,
      consultationBookingDate: true,
      consultationBookingKyivDay: true,
      consultationCancelled: true,
      paidServiceDate: true,
      paidServiceKyivDay: true,
      paidServiceRecordCreatedAt: true,
      paidServiceTotalCost: true,
      paidServiceIsRebooking: true,
      signedUpForPaidService: true,
      lastVisitAt: true,
    },
  });
  const withDays = await enrichClientsDaysLikeDirect(raw, todayKyiv, 0);
  return withDays.filter((client) => {
    const altegioId = Number(client.altegioClientId);
    if (!Number.isFinite(altegioId) || altegioId <= 0) return false;
    return isActiveBaseOnKyivDay(client, todayKyiv);
  });
}

export async function GET(req: NextRequest) {
  const gate = await requireDeveloper(req);
  if (gate !== true) return gate;

  if (req.nextUrl.searchParams.get("check") === "1") {
    return NextResponse.json(
      { ok: true, developer: true },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } }
    );
  }

  try {
    const todayKyiv = getTodayKyiv();
    const clients = await loadActiveBaseForExport(todayKyiv);
    const file = buildFacebookCustomerListCsv(
      clients.map((client) => ({
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
        spent: client.spent,
      }))
    );
    const filename = `aktyvna-baza-facebook-${todayKyiv}.csv`;
    console.log(
      `[inactive-base/facebook-audience] Активна=${clients.length}, у файлі=${file.rows}, Україна=${file.ua}, без телефону=${file.skipped}, злито дублікатів=${file.merged} (${todayKyiv})`
    );

    return new NextResponse(file.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Audience-Rows": String(file.rows),
        "X-Audience-Ua": String(file.ua),
        "X-Audience-Skipped": String(file.skipped),
        "X-Audience-Merged": String(file.merged),
      },
    });
  } catch (err) {
    console.error("[inactive-base/facebook-audience] Не вдалося зібрати файл:", err);
    return NextResponse.json({ ok: false, error: "Не вдалося зібрати файл" }, { status: 500 });
  }
}
