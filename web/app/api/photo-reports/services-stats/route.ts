// web/app/api/photo-reports/services-stats/route.ts
// API endpoint для отримання статистики послуг "Нарощування волосся" по майстрах

import { NextRequest, NextResponse } from "next/server";
import { assertAltegioEnv } from "@/lib/altegio/env";
import { getAppointments } from "@/lib/altegio/appointments";
import { getVisits } from "@/lib/altegio/visits"; // Спробуємо visits як альтернативу
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import { altegioFetch } from "@/lib/altegio/client";
import { findMasterByAltegioStaffId } from "@/lib/photo-reports/service";
import { kvRead } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Отримує список service_id з категорії послуг
 * @param companyId - ID компанії
 * @param categoryId - ID категорії послуг (наприклад, 11928106)
 */
async function getServiceIdsFromCategory(
  companyId: number,
  categoryId: number
): Promise<number[]> {
  try {
    console.log(
      `[photo-reports/services-stats] Fetching services from category ${categoryId} for company ${companyId}`
    );

    // Спробуємо різні endpoint'и для отримання послуг
    // Згідно з документацією: GET /company/{company_id}/services - отримує всі послуги, потім фільтруємо за category_id
    const attempts = [
      {
        name: "GET /company/{id}/services (then filter by category_id)",
        url: `/company/${companyId}/services`,
        filterByCategory: true,
      },
      {
        name: "GET /services?company_id={id}",
        url: `/services?company_id=${companyId}`,
        filterByCategory: true,
      },
      {
        name: "GET /company/{id}/service_category/{category_id}/services",
        url: `/company/${companyId}/service_category/${categoryId}/services`,
        filterByCategory: false,
      },
      {
        name: "GET /service_category/{category_id}/services",
        url: `/service_category/${categoryId}/services?company_id=${companyId}`,
        filterByCategory: false,
      },
      {
        name: "GET /company/{id}/services?category_id={id}",
        url: `/company/${companyId}/services?category_id=${categoryId}`,
        filterByCategory: false,
      },
      {
        name: "GET /services?company_id={id}&category_id={id}",
        url: `/services?company_id=${companyId}&category_id=${categoryId}`,
        filterByCategory: false,
      },
    ];

    for (const attempt of attempts) {
      try {
        console.log(
          `[photo-reports/services-stats] Trying ${attempt.name}...`
        );
        const response = await altegioFetch<any>(attempt.url);

        let services: any[] = [];
        if (Array.isArray(response)) {
          services = response;
        } else if (response && typeof response === "object") {
          if (Array.isArray(response.data)) {
            services = response.data;
          } else if (Array.isArray(response.services)) {
            services = response.services;
          } else if (Array.isArray(response.items)) {
            services = response.items;
          }
        }

        if (services.length > 0) {
          // Якщо потрібно фільтрувати за category_id (отримали всі послуги)
          if (attempt.filterByCategory) {
            const totalServices = services.length;
            services = services.filter((s) => {
              const serviceCategoryId =
                s.category_id ||
                s.service_category_id ||
                s.category?.id ||
                s.service_category?.id;
              return serviceCategoryId === categoryId;
            });
            console.log(
              `[photo-reports/services-stats] Filtered ${services.length} services from ${totalServices} total by category_id ${categoryId}`
            );
          }

          const serviceIds = services
            .map((s) => s.id || s.service_id)
            .filter((id): id is number => typeof id === "number" && !isNaN(id));

          if (serviceIds.length > 0) {
            console.log(
              `[photo-reports/services-stats] ✅ Got ${serviceIds.length} service IDs from category ${categoryId} using ${attempt.name}`
            );
            return serviceIds;
          }
        }
      } catch (err) {
        console.warn(
          `[photo-reports/services-stats] Failed with ${attempt.name}:`,
          err instanceof Error ? err.message : String(err)
        );
        continue;
      }
    }

    console.warn(
      `[photo-reports/services-stats] Could not fetch services from category ${categoryId}, falling back to name-based filtering`
    );
    return [];
  } catch (err) {
    console.error(
      `[photo-reports/services-stats] Error fetching services from category:`,
      err
    );
    return [];
  }
}

/**
 * Перевіряє, чи послуга належить до потрібної категорії або відповідає назві "Нарощування волосся"
 */
function isHairExtensionService(
  service: any,
  allowedServiceIds: number[]
): boolean {
  if (!service) return false;

  // Якщо є список дозволених service_id, перевіряємо за ID
  if (allowedServiceIds.length > 0) {
    const serviceId = service.id || service.service_id;
    if (serviceId && allowedServiceIds.includes(serviceId)) {
      return true;
    }
  }

  // Fallback: перевіряємо за назвою (якщо не вдалося отримати список з категорії)
  const serviceName =
    service.title || service.name || service.service_name || "";

  const normalized = serviceName.toLowerCase().trim();

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

  // Використовуємо ALTEGIO_COMPANY_ID (ID філії/салону), а не PARTNER_ID
  const envCompanyId = process.env.ALTEGIO_COMPANY_ID;
  if (envCompanyId) {
    const parsed = parseInt(envCompanyId, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // Fallback на PARTNER_ID, якщо ALTEGIO_COMPANY_ID не встановлено
  const envPartnerId = ALTEGIO_ENV.PARTNER_ID;
  if (envPartnerId) {
    const parsed = parseInt(envPartnerId, 10);
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

    // Отримуємо category_id з параметрів або ENV (ID категорії "Нарощування волосся")
    const categoryIdParam = req.nextUrl.searchParams.get("category_id");
    const categoryId = categoryIdParam
      ? parseInt(categoryIdParam, 10)
      : parseInt(process.env.ALTEGIO_SERVICE_CATEGORY_ID || "11928106", 10);

    const nowDate = new Date();
    const pastDate = new Date(nowDate);
    pastDate.setDate(pastDate.getDate() - daysBack);

    // dateTo має бути сьогодні (включно), а не вчора
    const dateFrom = pastDate.toISOString().split("T")[0];
    const dateTo = nowDate.toISOString().split("T")[0];

    console.log(
      `[photo-reports/services-stats] Fetching appointments from ${dateFrom} to ${dateTo} for company ${companyId}, category ${categoryId}`
    );

    // Отримуємо список service_id з категорії
    const allowedServiceIds = await getServiceIdsFromCategory(
      companyId,
      categoryId
    );

    console.log(
      `[photo-reports/services-stats] Will filter by ${allowedServiceIds.length} service IDs:`,
      allowedServiceIds.slice(0, 5),
      allowedServiceIds.length > 5 ? `... (${allowedServiceIds.length} total)` : ""
    );

    // Отримуємо дані з Altegio
    // Спочатку пробуємо visits (завершені записи) - вони більше підходять для статистики
    // Якщо visits не працює, пробуємо appointments
    // Спробуємо отримати дані для кожного service_id окремо, якщо загальні endpoint'и не працюють
    let appointments: any[] = [];
    
    // Якщо отримали список service_id, спробуємо отримати дані для кожного service_id окремо
    if (allowedServiceIds.length > 0) {
      console.log(
        `[photo-reports/services-stats] Trying to get visits/appointments for each service_id separately...`
      );
      
      // Спробуємо отримати дані для перших 5 service_id (щоб не робити занадто багато запитів)
      const serviceIdsToTry = allowedServiceIds.slice(0, 5);
      
      for (const serviceId of serviceIdsToTry) {
        try {
          // Спробуємо visits з фільтром за service_id
          const visits = await getVisits(companyId, {
            dateFrom,
            dateTo,
            includeClient: true,
            includeService: true,
            includeStaff: true,
            // Додамо фільтр за service_id, якщо підтримується
          });
          
          // Фільтруємо за service_id вручну
          const filteredVisits = visits.filter((v: any) => {
            const vServiceId = v.service_id || v.service?.id;
            return vServiceId === serviceId;
          });
          
          if (filteredVisits.length > 0) {
            console.log(
              `[photo-reports/services-stats] ✅ Got ${filteredVisits.length} visits for service_id ${serviceId}`
            );
            appointments.push(...filteredVisits);
          }
        } catch (err) {
          // Продовжуємо з наступним service_id
          continue;
        }
      }
    }
    
    // Якщо не отримали дані через окремі запити, пробуємо загальні endpoint'и
    if (appointments.length === 0) {
      try {
        console.log(
          `[photo-reports/services-stats] Trying to get visits (completed records) first...`
        );
        const visits = await getVisits(companyId, {
          dateFrom,
          dateTo,
          serviceIds: allowedServiceIds.length > 0 ? allowedServiceIds : undefined, // Фільтр за service_id з категорії
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
          serviceIds: allowedServiceIds.length > 0 ? allowedServiceIds : undefined, // Фільтр за service_id з категорії
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
            serviceIds: allowedServiceIds.length > 0 ? allowedServiceIds : undefined,
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

    // Якщо не отримали дані через API, спробуємо використати webhook дані
    if (appointments.length === 0) {
      console.log(
        `[photo-reports/services-stats] No appointments from API, trying webhook data...`
      );
      try {
        const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
        const records = recordsLogRaw
          .map((raw) => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })
          .filter((r) => r && r.visitId && r.datetime);

        console.log(
          `[photo-reports/services-stats] Found ${records.length} records from webhook log`
        );

        // Конвертуємо webhook records в appointments формат
        appointments = records.map((r: any) => ({
          id: r.visitId,
          datetime: r.datetime,
          end_datetime: r.datetime,
          service_id: r.serviceId,
          service: r.data?.service || (r.serviceId ? { id: r.serviceId, title: r.serviceName } : null),
          staff_id: r.staffId,
          staff: r.data?.staff || (r.staffId ? { id: r.staffId } : null),
          client_id: r.clientId,
          client: r.data?.client || (r.clientId ? { id: r.clientId } : null),
        }));
      } catch (webhookError) {
        console.warn(
          `[photo-reports/services-stats] Failed to get webhook records:`,
          webhookError instanceof Error ? webhookError.message : String(webhookError)
        );
      }
    }

    // Фільтруємо тільки завершені appointments (дата в минулому або сьогодні)
    // Для статистики включаємо також події, які вже відбулися сьогодні
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    
    const completedAppointments = appointments.filter((apt) => {
      const endDate = apt.end_datetime || apt.datetime || apt.date;
      if (!endDate) return false;
      const aptDate = new Date(endDate);
      // Включаємо appointments, які вже відбулися (в минулому або сьогодні до поточного часу)
      return aptDate < now;
    });

    console.log(
      `[photo-reports/services-stats] Found ${completedAppointments.length} completed appointments`
    );

    // Фільтруємо тільки послуги з потрібної категорії
    const hairExtensionAppointments = completedAppointments.filter((apt) => {
      // Якщо є об'єкт service - перевіряємо його
      if (apt.service) {
        return isHairExtensionService(apt.service, allowedServiceIds);
      }
      // Якщо service не завантажено, але є service_id - перевіряємо за ID
      const serviceId = (apt as any).service_id;
      if (serviceId && allowedServiceIds.length > 0) {
        return allowedServiceIds.includes(serviceId);
      }
      // Якщо не вдалося отримати список service_id з категорії, пропускаємо
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

