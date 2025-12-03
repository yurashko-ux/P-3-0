// web/app/api/cron/photo-reminders/route.ts
// Cron job для відправки нагадувань про фото-звіти на основі реальних подій з Altegio

import { NextRequest, NextResponse } from "next/server";
import { assertAltegioEnv } from "@/lib/altegio/env";
import { getAppointments } from "@/lib/altegio/appointments";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import {
  findMasterByAltegioStaffId,
  convertAltegioAppointmentToReminder,
} from "@/lib/photo-reports/service";
import { getChatIdForMaster } from "@/lib/photo-reports/master-registry";
import {
  sendReminderMessage,
  notifyAdminsPlaceholder,
} from "@/lib/photo-reports/reminders";
import { getPhotoReportByAppointmentId } from "@/lib/photo-reports/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Перевіряє, чи запит дозволений (тільки Vercel Cron або з секретом)
 */
function okCron(req: NextRequest) {
  // 1) Дозволяємо офіційний крон Vercel
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  if (isVercelCron) return true;

  // 2) Або запит з локальним секретом (на випадок ручного виклику)
  const urlSecret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  if (envSecret && urlSecret && envSecret === urlSecret) return true;

  return false;
}

/**
 * Отримує company_id з ENV або з параметрів запиту
 */
function getCompanyId(req: NextRequest): number | null {
  // Спробуємо з query параметрів
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
  return POST(req);
}

export async function POST(req: NextRequest) {
  console.log("[cron/photo-reminders] POST request received");

  if (!okCron(req)) {
    console.log(
      "[cron/photo-reminders] Request forbidden - not a valid cron request"
    );
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 }
    );
  }

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

    // Параметри з body або query
    const body = await req.json().catch(() => ({}));
    const minutesAhead =
      body.minutesAhead ||
      parseInt(req.nextUrl.searchParams.get("minutesAhead") || "20", 10);

    console.log(
      `[cron/photo-reminders] Processing reminders for company ${companyId}, minutesAhead=${minutesAhead}`
    );

    // Отримуємо appointments з Altegio
    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setMinutes(futureDate.getMinutes() + minutesAhead);

    const dateFrom = now.toISOString().split("T")[0];
    const dateTo = futureDate.toISOString().split("T")[0];

    console.log(
      `[cron/photo-reminders] Fetching appointments from ${dateFrom} to ${dateTo}`
    );

    const rawAppointments = await getAppointments(companyId, {
      dateFrom,
      dateTo,
      includeClient: true,
    });

    console.log(
      `[cron/photo-reminders] Got ${rawAppointments.length} appointments from Altegio (before dedupe)`
    );

    // Дедуплікуємо випадки, коли одного й того ж клієнта на ту ж послугу/час
    // записали до кількох майстрів. Залишаємо той запис, у якого менший id
    // (вважаємо, що він створений раніше).
    const dedupeMap: Record<string, any> = {};
    for (const apt of rawAppointments) {
      const clientId = (apt as any).client_id || "unknown";
      const serviceId = (apt as any).service_id || "unknown";
      const datetime =
        (apt as any).datetime ||
        (apt as any).start_datetime ||
        (apt as any).date ||
        "unknown";

      const key = `${clientId}|${serviceId}|${datetime}`;
      const existing = dedupeMap[key];
      if (!existing || (apt.id && apt.id < existing.id)) {
        dedupeMap[key] = apt;
      }
    }

    const appointments = Object.values(dedupeMap);

    console.log(
      `[cron/photo-reminders] Using ${appointments.length} appointments after dedupe`
    );

    const results = {
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // Фільтруємо appointments, які закінчуються в найближчому часі
    const nowTime = now.getTime();
    const futureTime = futureDate.getTime();

    for (const appointment of appointments) {
      try {
        results.processed++;

        // Отримуємо час закінчення
        const endDateTime =
          appointment.end_datetime || appointment.datetime || appointment.date;
        if (!endDateTime) {
          console.warn(
            `[cron/photo-reminders] Appointment ${appointment.id} missing end_datetime`
          );
          results.skipped++;
          continue;
        }

        const endTime = new Date(endDateTime).getTime();

        // Перевіряємо, чи appointment закінчується в потрібному діапазоні
        if (endTime < nowTime || endTime > futureTime) {
          results.skipped++;
          continue;
        }

        // Перевіряємо, чи вже є фото-звіт для цього appointment
        const appointmentId = `altegio-${appointment.id}`;
        const existingReport = await getPhotoReportByAppointmentId(
          appointmentId
        );
        if (existingReport) {
          console.log(
            `[cron/photo-reminders] Appointment ${appointment.id} already has photo report`
          );
          results.skipped++;
          continue;
        }

        // Знаходимо майстра за staff_id
        const staffId = appointment.staff_id;
        if (!staffId) {
          console.warn(
            `[cron/photo-reminders] Appointment ${appointment.id} missing staff_id`
          );
          results.skipped++;
          continue;
        }

        const master = findMasterByAltegioStaffId(staffId);
        if (!master) {
          console.warn(
            `[cron/photo-reminders] Master not found for staff_id ${staffId} (appointment ${appointment.id})`
          );
          results.skipped++;
          continue;
        }

        // Отримуємо chatId для майстра
        const chatId = await getChatIdForMaster(master.id);
        if (!chatId) {
          console.warn(
            `[cron/photo-reminders] Chat not registered for master ${master.id} (staff_id ${staffId})`
          );
          results.skipped++;
          continue;
        }

        // Конвертуємо appointment в reminder
        const reminder = convertAltegioAppointmentToReminder(
          appointment,
          master
        );
        if (!reminder) {
          console.warn(
            `[cron/photo-reminders] Failed to convert appointment ${appointment.id} to reminder`
          );
          results.skipped++;
          continue;
        }

        // Відправляємо нагадування майстру
        console.log(
          `[cron/photo-reminders] Sending reminder for appointment ${appointment.id} to master ${master.name} (chatId: ${chatId})`
        );

        await sendReminderMessage(chatId, reminder);

        // Паралельно сповіщаємо адміністратора(ів) тим самим контекстом
        await notifyAdminsPlaceholder(
          [
            "📸 <b>Нове нагадування про фото-звіт</b>",
            "",
            `<b>Майстер:</b> ${master.name}`,
            `<b>Клієнт:</b> ${reminder.clientName}`,
            `<b>Послуга:</b> ${reminder.serviceName}`,
            `<b>Закінчується о:</b> ${new Date(
              reminder.endAt
            ).toLocaleTimeString("uk-UA", {
              hour: "2-digit",
              minute: "2-digit",
            })}`,
          ].join("\n")
        );

        results.sent++;
        console.log(
          `[cron/photo-reminders] ✅ Successfully sent reminder for appointment ${appointment.id}`
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[cron/photo-reminders] Error processing appointment ${appointment.id}:`,
          errorMsg
        );
        results.errors.push(`Appointment ${appointment.id}: ${errorMsg}`);
      }
    }

    const response = {
      ok: true,
      timestamp: new Date().toISOString(),
      companyId,
      minutesAhead,
      summary: results,
    };

    console.log(
      `[cron/photo-reminders] Processing completed:`,
      JSON.stringify(response, null, 2)
    );

    return NextResponse.json(response);
  } catch (e: any) {
    console.error("[cron/photo-reminders] Fatal error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: String(e),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

