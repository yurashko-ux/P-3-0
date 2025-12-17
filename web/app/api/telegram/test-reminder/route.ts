// web/app/api/telegram/test-reminder/route.ts
// Тестовий endpoint для відправки нагадування про фото-звіт конкретному користувачу

import { NextRequest, NextResponse } from "next/server";
import { assertTelegramEnv } from "@/lib/telegram/env";
import { sendReminderMessage } from "@/lib/photo-reports/reminders";
import { listRegisteredChats } from "@/lib/photo-reports/master-registry";
import { findMasterByUsername } from "@/lib/photo-reports/service";
import { AppointmentReminder } from "@/lib/photo-reports/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertTelegramEnv();

    const body = (await req.json().catch(() => ({}))) as {
      chatId?: number;
      telegramUsername?: string;
      clientName?: string;
      serviceName?: string;
      minutesUntilEnd?: number;
    };

    // Отримуємо chatId
    let chatId: number | null = null;

    if (body.chatId) {
      chatId = body.chatId;
    } else if (body.telegramUsername) {
      // Шукаємо майстра за username
      const master = findMasterByUsername(body.telegramUsername);
      if (master) {
        // Шукаємо зареєстрований чат за username в реєстрі
        const registeredChats = await listRegisteredChats();
        const foundChat = registeredChats.find(
          (chat) =>
            chat.username?.toLowerCase() === body.telegramUsername?.toLowerCase() ||
            chat.masterId === master.id
        );
        if (foundChat) {
          chatId = foundChat.chatId;
        }
      }
    }

    if (!chatId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "chatId not found. Please send /start to the Telegram bot first, then try again.",
          hint: body.telegramUsername
            ? `Username "${body.telegramUsername}" not registered. Send /start to the bot.`
            : "Provide chatId or telegramUsername in the request body.",
        },
        { status: 400 }
      );
    }

    // Створюємо тестовий appointment
    const now = new Date();
    const minutesUntilEnd = body.minutesUntilEnd || 15;
    const endAt = new Date(now);
    endAt.setMinutes(endAt.getMinutes() + minutesUntilEnd);

    const testAppointment: AppointmentReminder = {
      id: `test-${Date.now()}`,
      clientName: body.clientName || "Тестовий клієнт",
      serviceName: body.serviceName || "Тестова послуга",
      masterId: "master-test",
      masterName: "Тестовий майстер",
      startAt: now.toISOString(),
      endAt: endAt.toISOString(),
    };

    // Відправляємо нагадування
    await sendReminderMessage(chatId, testAppointment);

    return NextResponse.json({
      ok: true,
      message: "Test reminder sent successfully",
      chatId,
      appointment: testAppointment,
    });
  } catch (error) {
    console.error("[telegram/test-reminder] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

