import { NextRequest, NextResponse } from "next/server";
import { assertTelegramEnv } from "@/lib/telegram/env";
import { getUpcomingMockAppointmentsBuffer } from "@/lib/photo-reports/service";
import { getChatIdForMaster } from "@/lib/photo-reports/master-registry";
import { sendReminderMessage } from "@/lib/photo-reports/reminders";
import { getPhotoReportByAppointmentId } from "@/lib/photo-reports/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertTelegramEnv();

    const { minutesAhead = 20 } = (await req.json().catch(() => ({}))) as {
      minutesAhead?: number;
    };

    const appointments = getUpcomingMockAppointmentsBuffer(minutesAhead);
    const results: Array<{ appointmentId: string; status: string }> = [];

    for (const appointment of appointments) {
      const existingReport = await getPhotoReportByAppointmentId(
        appointment.id
      );
      if (existingReport) {
        results.push({
          appointmentId: appointment.id,
          status: "already_reported",
        });
        continue;
      }

      const chatId = await getChatIdForMaster(appointment.masterId);
      if (!chatId) {
        results.push({
          appointmentId: appointment.id,
          status: "no_chat",
        });
        continue;
      }

      await sendReminderMessage(chatId, appointment);
      results.push({ appointmentId: appointment.id, status: "sent" });
    }

    return NextResponse.json({
      ok: true,
      message: `Processed ${appointments.length} appointments`,
      results,
    });
  } catch (error) {
    console.error("[telegram/mock-reminders] Error:", error);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

