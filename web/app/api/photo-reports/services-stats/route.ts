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

    const nowDate = new Date();
    const pastDate = new Date(nowDate);
    pastDate.setDate(pastDate.getDate() - daysBack);

    const dateFrom = pastDate.toISOString().split("T")[0];
    const dateTo = nowDate.toISOString().split("T")[0];

    console.log(
      `[photo-reports/services-stats] Fetching appointments from ${dateFrom} to ${dateTo} for company ${companyId}`
    );

    // Отримуємо дані з Altegio
    // Спочатку пробуємо visits (завершені записи) - вони більше підходять для статистики
    // Якщо visits не працює, пробуємо appointments
    let appointments: any[] = [];
    
    try {
      console.log(
        `[photo-reports/services-stats] Trying to get visits (completed records) first...`
      );
      const visits = await getVisits(companyId, {
        dateFrom,
        dateTo,
        includeClient: true,
        includeService: true,
        includeStaff: true,
      });
      
      if (visits.length > 0) {
        console.log(
          `[photo-reports/services-stats] ✅ Got ${visits.length} visits, using them as appointments`
        );
        // Visits мають схожу структуру з appointments
        appointments = visits as any[];
      }
    } catch (visitsError) {
      console.warn(
        `[photo-reports/services-stats] Visits failed, trying appointments:`,
        visitsError instanceof Error ? visitsError.message : String(visitsError)
      );
    }
    
    // Якщо visits не спрацювало, пробуємо appointments
    if (appointments.length === 0) {
      try {
        console.log(
          `[photo-reports/services-stats] Trying to get appointments...`
        );
        appointments = await getAppointments(companyId, {
          dateFrom,
          dateTo,
          // Не використовуємо include параметри - спробуємо отримати базові appointments
        });
        
        // Якщо не спрацювало, спробуємо з includeClient (найпростіший варіант)
        if (appointments.length === 0) {
          console.log(
            `[photo-reports/services-stats] No appointments without include, trying with includeClient only`
          );
          appointments = await getAppointments(companyId, {
            dateFrom,
            dateTo,
            includeClient: true,
          });
        }
      } catch (appointmentsError) {
        console.error(
          `[photo-reports/services-stats] Appointments also failed:`,
          appointmentsError instanceof Error ? appointmentsError.message : String(appointmentsError)
        );
        // Продовжуємо з порожнім масивом
      }
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
    // Перевіряємо service з appointment або service_id (якщо service не завантажено)
    const hairExtensionAppointments = completedAppointments.filter((apt) => {
      // Якщо є об'єкт service - перевіряємо його
      if (apt.service) {
        return isHairExtensionService(apt.service);
      }
      // Якщо service не завантажено, але є service_id - спробуємо використати service_id
      // Але для цього потрібно знати ID послуги "Нарощування волосся"
      // Поки що пропускаємо appointments без service об'єкта
      // TODO: Можна додати список service_id для "Нарощування волосся" для фільтрації
      return false;
    });
    
    // Логуємо приклад appointment для діагностики
    if (completedAppointments.length > 0 && hairExtensionAppointments.length === 0) {
      const sampleApt = completedAppointments[0];
      console.log(
        `[photo-reports/services-stats] Sample appointment structure:`,
        {
          id: sampleApt.id,
          service_id: (sampleApt as any).service_id,
          hasService: !!sampleApt.service,
          serviceKeys: sampleApt.service ? Object.keys(sampleApt.service) : [],
          allKeys: Object.keys(sampleApt),
        }
      );
    }

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

