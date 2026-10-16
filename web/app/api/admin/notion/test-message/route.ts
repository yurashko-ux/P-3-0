import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendNotionTelegram } from "@/lib/notion/notify";
import { requireNotionSection } from "@/lib/notion/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireNotionSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as { recipientId?: unknown } | null;
  const recipientId = String(body?.recipientId ?? "").trim();
  if (!recipientId) return NextResponse.json({ error: "Не вибрано отримувача" }, { status: 400 });

  const recipient = await prisma.notificationRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient) return NextResponse.json({ error: "Отримувача не знайдено" }, { status: 404 });

  try {
    await sendNotionTelegram(recipient.telegramChatId, "Тестове сповіщення Notion з CRM");
    console.log("[notion] тестове повідомлення надіслано", recipient.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося надіслати тест";
    console.error("[notion] тестове повідомлення не пішло", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
