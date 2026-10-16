import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseDatabaseId, parseEventType, parsePropertyId } from "@/lib/notion/validators";
import { requireNotionSection } from "@/lib/notion/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: { id: string } | Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireNotionSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as {
    databaseId?: unknown;
    eventType?: unknown;
    propertyId?: unknown;
    recipientId?: unknown;
    enabled?: unknown;
  } | null;
  const data: {
    databaseId?: string;
    eventType?: string;
    propertyId?: string | null;
    recipientId?: string;
    enabled?: boolean;
  } = {};

  if (body && "databaseId" in body) {
    const databaseId = parseDatabaseId(body.databaseId);
    if (!databaseId) return NextResponse.json({ error: "Невідома база" }, { status: 400 });
    data.databaseId = databaseId;
  }
  if (body && "eventType" in body) {
    const eventType = parseEventType(body.eventType);
    if (!eventType) return NextResponse.json({ error: "Невідома подія" }, { status: 400 });
    data.eventType = eventType;
    if (eventType !== "page.properties_updated") data.propertyId = null;
  }
  if (body && "propertyId" in body) data.propertyId = parsePropertyId(body.propertyId);
  if (body && "recipientId" in body) {
    const recipientId = String(body.recipientId ?? "").trim();
    const recipient = await prisma.notificationRecipient.findUnique({ where: { id: recipientId } });
    if (!recipient) return NextResponse.json({ error: "Отримувача не знайдено" }, { status: 400 });
    data.recipientId = recipientId;
  }
  if (body && "enabled" in body) data.enabled = Boolean(body.enabled);
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Немає полів для зміни" }, { status: 400 });
  }

  try {
    const rule = await prisma.notificationRule.update({ where: { id }, data });
    console.log("[notion] оновлено правило", rule.id);
    return NextResponse.json({ ok: true, rule });
  } catch {
    return NextResponse.json({ error: "Правило не знайдено" }, { status: 404 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireNotionSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    await prisma.notificationRule.delete({ where: { id } });
    console.log("[notion] видалено правило", id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Правило не знайдено" }, { status: 404 });
  }
}
