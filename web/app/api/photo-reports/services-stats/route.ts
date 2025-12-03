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

  // Якщо є список дозволених service_id, намагаємось спочатку перевірити за ID
  if (allowedServiceIds.length > 0) {
    const serviceId = service.id || service.service_id;
    if (serviceId && allowedServiceIds.includes(serviceId)) {
      return true;
    }
  }

  // Fallback: у будь‑якому разі перевіряємо за назвою.
  // Це дозволяє підхопити нові послуги з "нарощуванням", навіть якщо їх service_id
  // ще не потрапив у категорію або категорія змінилась.
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

    // Прапорець: включати майбутні послуги чи тільки завершені
    const includeFutureParam = req.nextUrl.searchParams.get("includeFuture");
    const includeFuture =
      includeFutureParam === "true" || includeFutureParam === "1";

    // Отримуємо category_id з параметрів або ENV (ID категорії "Нарощування волосся")
    const categoryIdParam = req.nextUrl.searchParams.get("category_id");
    const categoryId = categoryIdParam
      ? parseInt(categoryIdParam, 10)
      : parseInt(process.env.ALTEGIO_SERVICE_CATEGORY_ID || "11928106", 10);

    const nowDate = new Date();
    const pastDate = new Date(nowDate);
    pastDate.setDate(pastDate.getDate() - daysBack);

    // dateTo встановлюємо на 04.12.2025 (включно)
    const dateFrom = pastDate.toISOString().split("T")[0];
    const dateTo = "2025-12-04"; // Фіксована кінцева дата періоду

    console.log(
      `[photo-reports/services-stats] 📅 Period calculation: nowDate=${nowDate.toISOString()}, dateFrom=${dateFrom}, dateTo=${dateTo}, daysBack=${daysBack}`
    );
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

    // Отримуємо дані про записи.
    // ВАЖЛИВО: через те, що всі endpoint'и Altegio для visits/appointments стабільно повертають 404,
    // ми повністю пропускаємо прямі API-запити та одразу використовуємо webhook-лог як єдине джерело правди.
    // Це дозволяє будувати статистику, навіть коли API недоступне.
    let appointments: any[] = [];
    console.log(
      `[photo-reports/services-stats] ⏭️ Skipping Altegio visits/appointments API (all endpoints return 404), using webhook records only`
    );

    // Якщо не отримали дані через API, спробуємо використати webhook дані
    if (appointments.length === 0) {
      console.log(
        `[photo-reports/services-stats] 🔍 Checking if fallback to webhook data is needed...`
      );
      console.log(
        `[photo-reports/services-stats] ⚠️ No appointments from API (all endpoints returned 404 or empty), trying webhook data fallback...`
      );
      try {
        const webhookLogRaw = await kvRead.lrange("altegio:webhook:log", 0, 9999);
        const records = webhookLogRaw
          .map((raw) => {
            try {
              const parsed = JSON.parse(raw);
              // Upstash може повертати елементи як { value: "..." }
              if (
                parsed &&
                typeof parsed === "object" &&
                "value" in parsed &&
                typeof parsed.value === "string"
              ) {
                try {
                  return JSON.parse(parsed.value);
                } catch {
                  return null;
                }
              }
              return parsed;
            } catch {
              return null;
            }
          })
          .map((e: any) => {
            const body = e?.body || e;
            if (!body || body.resource !== "record" || !body.data) return null;
            const data = body.data;

            const services = Array.isArray(data.services)
              ? data.services
              : data.service
              ? [data.service]
              : [];
            const firstService = services[0] || null;

            return {
              visitId: data.visit_id || body.resource_id,
              recordId: body.resource_id,
              datetime: data.datetime,
              serviceId: firstService?.id || data.service_id,
              serviceName:
                firstService?.title ||
                firstService?.name ||
                data.service?.title ||
                data.service?.name,
              staffId: data.staff?.id || data.staff_id,
              clientId: data.client?.id || data.client_id,
              companyId: data.company_id || body.company_id,
              receivedAt: e.receivedAt || new Date().toISOString(),
              data: {
                service: firstService || data.service,
                services,
                staff: data.staff,
                client: data.client,
              },
            };
          })
          .filter((r) => {
            if (!r || !r.visitId || !r.datetime) {
              console.log(
                `[photo-reports/services-stats] ⏭️ Skipping record: missing visitId or datetime`,
                { visitId: r?.visitId, datetime: r?.datetime }
              );
              return false;
            }
            // Фільтруємо за періодом dateFrom - dateTo (включно)
            const recordDate = new Date(r.datetime).toISOString().split("T")[0];
            const inPeriod = recordDate >= dateFrom && recordDate <= dateTo;
            if (!inPeriod) {
              console.log(
                `[photo-reports/services-stats] ⏭️ Skipping record: date ${recordDate} not in period ${dateFrom} - ${dateTo}`,
                { visitId: r.visitId, serviceId: r.serviceId }
              );
            }
            return inPeriod;
          });

        console.log(
          `[photo-reports/services-stats] Found ${records.length} records from webhook log (after filtering by period ${dateFrom} - ${dateTo})`
        );
        
        // Логуємо приклад records для діагностики
        if (records.length > 0) {
          const sampleRecord = records[0];
          console.log(
            `[photo-reports/services-stats] Sample record:`,
            {
              visitId: sampleRecord.visitId,
              serviceId: sampleRecord.serviceId,
              serviceName: sampleRecord.serviceName,
              datetime: sampleRecord.datetime,
              staffId: sampleRecord.staffId,
            }
          );
        }

        // Конвертуємо webhook records в appointments формат
        appointments = records.map((r: any) => ({
          id: r.visitId,
          datetime: r.datetime,
          end_datetime: r.datetime,
          service_id: r.serviceId,
          service:
            r.data?.service ||
            (r.serviceId ? { id: r.serviceId, title: r.serviceName } : null),
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

    // Визначаємо, які appointments вважаємо "завершеними"
    let completedAppointments: any[];

    if (includeFuture) {
      // Для тестів/аналітики: включаємо ВСІ події у періоді (минулі + майбутні)
      completedAppointments = appointments;
      console.log(
        `[photo-reports/services-stats] includeFuture=true, using all ${completedAppointments.length} appointments in period`
      );
    } else {
      // У бойовому режимі: тільки ті, що вже відбулись
      const now = new Date();
      completedAppointments = appointments.filter((apt) => {
        const endDate = apt.end_datetime || apt.datetime || apt.date;
        if (!endDate) return false;
        const aptDate = new Date(endDate);
        return aptDate < now;
      });

      console.log(
        `[photo-reports/services-stats] includeFuture=false, found ${completedAppointments.length} completed appointments`
      );
    }

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

