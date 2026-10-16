import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseChatId } from "@/lib/notion/validators";
import { requireNotionSection } from "@/lib/notion/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: { id: string } | Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireNotionSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    telegramChatId?: unknown;
    enabled?: unknown;
  } | null;
  const data: { name?: string; telegramChatId?: bigint; enabled?: boolean } = {};
  if (body && "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Ім’я не може бути порожнім" }, { status: 400 });
    data.name = name.slice(0, 120);
  }
  if (body && "telegramChatId" in body) {
    const telegramChatId = parseChatId(body.telegramChatId);
    if (!telegramChatId) return NextResponse.json({ error: "Chat id має бути числом" }, { status: 400 });
    data.telegramChatId = telegramChatId;
  }
  if (body && "enabled" in body) data.enabled = Boolean(body.enabled);
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Немає полів для зміни" }, { status: 400 });
  }

  try {
    const recipient = await prisma.notificationRecipient.update({
      where: { id },
      data,
    });
    console.log("[notion] оновлено отримувача", recipient.id);
    return NextResponse.json({
      ok: true,
      recipient: {
        id: recipient.id,
        name: recipient.name,
        telegramChatId: recipient.telegramChatId.toString(),
        enabled: recipient.enabled,
      },
    });
  } catch {
    return NextResponse.json({ error: "Отримувача не знайдено" }, { status: 404 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireNotionSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    await prisma.notificationRecipient.delete({ where: { id } });
    console.log("[notion] видалено отримувача", id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Отримувача не знайдено" }, { status: 404 });
  }
}
