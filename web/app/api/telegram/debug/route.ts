import { NextRequest, NextResponse } from "next/server";
import { assertTelegramEnv } from "@/lib/telegram/env";
import { getMasters } from "@/lib/photo-reports/service";
import { listRegisteredChats } from "@/lib/photo-reports/master-registry";
import {
  listRecentPhotoReports,
  getPendingPhotoRequest,
} from "@/lib/photo-reports/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    assertTelegramEnv();

    const masters = getMasters();
    const registeredChats = await listRegisteredChats();
    const recentReports = await listRecentPhotoReports(20);

    const pending = await Promise.all(
      registeredChats.map(async (chat) => ({
        chatId: chat.chatId,
        pending: await getPendingPhotoRequest(Number(chat.chatId)),
      }))
    );

    return NextResponse.json({
      ok: true,
      masters,
      registeredChats,
      recentReports,
      pendingByChat: pending.filter((item) => item.pending),
    });
  } catch (error) {
    console.error("[telegram/debug] error", error);
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

