// web/app/api/telegram/get-chat-id/route.ts
// Endpoint для отримання chatId зареєстрованого користувача

import { NextRequest, NextResponse } from "next/server";
import { assertTelegramEnv } from "@/lib/telegram/env";
import { listRegisteredChats } from "@/lib/photo-reports/master-registry";
import { findMasterByUsername } from "@/lib/photo-reports/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    assertTelegramEnv();

    const username = req.nextUrl.searchParams.get("username");

    if (!username) {
      // Повертаємо всі зареєстровані чати
      const registeredChats = await listRegisteredChats();
      return NextResponse.json({
        ok: true,
        registeredChats: registeredChats.map((chat) => ({
          chatId: chat.chatId,
          username: chat.username,
          masterId: chat.masterId,
          firstName: chat.firstName,
          lastName: chat.lastName,
          registeredAt: chat.registeredAt,
        })),
      });
    }

    // Шукаємо конкретного користувача
    const master = findMasterByUsername(username);
    if (!master) {
      return NextResponse.json(
        {
          ok: false,
          error: `Master with username "${username}" not found in registry`,
        },
        { status: 404 }
      );
    }

    const registeredChats = await listRegisteredChats();
    const foundChat = registeredChats.find(
      (chat) =>
        chat.username?.toLowerCase() === username.toLowerCase() ||
        chat.masterId === master.id
    );

    if (!foundChat) {
      return NextResponse.json(
        {
          ok: false,
          error: `Chat not registered for username "${username}". Please send /start to the bot first.`,
          master: {
            id: master.id,
            name: master.name,
            telegramUsername: master.telegramUsername,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      chatId: foundChat.chatId,
      master: {
        id: master.id,
        name: master.name,
        telegramUsername: master.telegramUsername,
      },
      registeredAt: foundChat.registeredAt,
    });
  } catch (error) {
    console.error("[telegram/get-chat-id] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

