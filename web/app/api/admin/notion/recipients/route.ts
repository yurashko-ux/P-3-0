import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseChatId } from "@/lib/notion/validators";
import { requireNotionSection } from "@/lib/notion/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireNotionSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as { name?: unknown; telegramChatId?: unknown } | null;
  const name = String(body?.name ?? "").trim();
  const telegramChatId = parseChatId(body?.telegramChatId);
  if (!name || !telegramChatId) {
    return NextResponse.json({ error: "Потрібні ім’я і числовий chat id" }, { status: 400 });
  }

  const recipient = await prisma.notificationRecipient.create({
    data: { name: name.slice(0, 120), telegramChatId },
  });
  console.log("[notion] додано отримувача", recipient.id);
  return NextResponse.json({
    ok: true,
    recipient: {
      id: recipient.id,
      name: recipient.name,
      telegramChatId: recipient.telegramChatId.toString(),
      enabled: recipient.enabled,
    },
  });
}
