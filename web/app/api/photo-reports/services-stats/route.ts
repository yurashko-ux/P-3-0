// web/app/api/photo-reports/services-stats/route.ts
// API endpoint для отримання статистики послуг "Нарощування волосся" по майстрах

import { NextRequest, NextResponse } from "next/server";
import { assertAltegioEnv } from "@/lib/altegio/env";
import { getAppointments } from "@/lib/altegio/appointments";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import { findMasterByAltegioStaffId } from "@/lib/photo-reports/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Перевіряє, чи назва послуги відповідає "Нарощування волосся"
 */
function isHairExtensionService(service: any): boolean {
  if (!service) return false;

  const serviceName =
    service.title ||
    service.name ||
    service.service_name ||
    "";

  const normalized = serviceName.toLowerCase().trim();

  // Перевіряємо різні варіанти назви
  return (
    normalized.includes("нарощування") ||
    normalized.includes("нарощення") ||
    normalized.includes("hair extension") ||
    normalized.includes("hair extensions")
  );
}

/**
 * Отримує company_id з ENV або з параметрів запиту
 */
function getCompanyId(req: NextRequest): number | null {
  const queryCompanyId = req.nextUrl.searchParams.get("company_id");
  if (queryCompanyId) {
    const parsed = parseInt(queryCompanyId, 10);
    if (!isNaN(parsed)) return parsed;
  }

  const envCompanyId = ALTEGIO_ENV.PARTNER_ID;
  if (envCompanyId) {
    const parsed = parseInt(envCompanyId, 10);
    if (!isNaN(parsed)) return parsed;
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    assertAltegioEnv();

    const companyId = getCompanyId(req);
    if (!companyId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "company_id required. Set ALTEGIO_PARTNER_ID in env or pass ?company_id=...",
        },
        { status: 400 }
      );
    }

    // Отримуємо параметри періоду
    const daysBack = parseInt(
      req.nextUrl.searchParams.get("daysBack") || "30",
      10
    );

    const now = new Date();
    const pastDate = new Date(now);
    pastDate.setDate(pastDate.getDate() - daysBack);

    const dateFrom = pastDate.toISOString().split("T")[0];
    const dateTo = now.toISOString().split("T")[0];

    console.log(
      `[photo-reports/services-stats] Fetching appointments from ${dateFrom} to ${dateTo} for company ${companyId}`
    );

    // Отримуємо appointments з Altegio (використовуємо appointments замість visits, бо visits endpoint не працює)
    // Спробуємо спочатку з фільтром за статусом "completed", якщо не спрацює - фільтруємо за датою
    let appointments = await getAppointments(companyId, {
      dateFrom,
      dateTo,
      status: "completed", // Спробуємо отримати тільки завершені
      includeClient: true,
      includeService: true,
      includeStaff: true,
    });

    // Якщо з фільтром completed не спрацювало (порожній результат), спробуємо без фільтру
    if (appointments.length === 0) {
      console.log(
        `[photo-reports/services-stats] No appointments with status=completed, trying without status filter`
      );
      appointments = await getAppointments(companyId, {
        dateFrom,
        dateTo,
        includeClient: true,
        includeService: true,
        includeStaff: true,
      });
    }

    console.log(
      `[photo-reports/services-stats] Got ${appointments.length} appointments from Altegio`
    );

    // Фільтруємо тільки завершені appointments (дата в минулому)
    const now = new Date();
    const completedAppointments = appointments.filter((apt) => {
      const endDate = apt.end_datetime || apt.datetime || apt.date;
      if (!endDate) return false;
      return new Date(endDate) < now;
    });

    console.log(
      `[photo-reports/services-stats] Found ${completedAppointments.length} completed appointments`
    );

    // Фільтруємо тільки послуги "Нарощування волосся"
    const hairExtensionAppointments = completedAppointments.filter((apt) =>
      isHairExtensionService(apt.service)
    );

    console.log(
      `[photo-reports/services-stats] Found ${hairExtensionAppointments.length} hair extension appointments`
    );

    // Підраховуємо по майстрах
    const statsByMaster: Record<
      string,
      { masterId: string; masterName: string; count: number }
    > = {};

    for (const appointment of hairExtensionAppointments) {
      const staffId = appointment.staff_id;
      if (!staffId) continue;

      const master = findMasterByAltegioStaffId(staffId);
      if (!master) {
        console.warn(
          `[photo-reports/services-stats] Master not found for staff_id ${staffId}`
        );
        continue;
      }

      if (!statsByMaster[master.id]) {
        statsByMaster[master.id] = {
          masterId: master.id,
          masterName: master.name,
          count: 0,
        };
      }

      statsByMaster[master.id].count++;
    }

    // Конвертуємо в масив
    const stats = Object.values(statsByMaster);

    return NextResponse.json({
      ok: true,
      period: {
        dateFrom,
        dateTo,
        daysBack,
      },
      totalAppointments: appointments.length,
      completedAppointments: completedAppointments.length,
      hairExtensionAppointments: hairExtensionAppointments.length,
      statsByMaster: stats,
    });
  } catch (error) {
    console.error("[photo-reports/services-stats] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

