import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseDatabaseId, parseEventType, parsePropertyId } from "@/lib/notion/validators";
import { requireNotionSection } from "@/lib/notion/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireNotionSection(req, "edit");
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as {
    databaseId?: unknown;
    eventType?: unknown;
    propertyId?: unknown;
    recipientId?: unknown;
    enabled?: unknown;
  } | null;
  const databaseId = parseDatabaseId(body?.databaseId);
  const eventType = parseEventType(body?.eventType);
  const recipientId = String(body?.recipientId ?? "").trim();
  if (!databaseId || !eventType || !recipientId) {
    return NextResponse.json({ error: "Потрібні база, подія і отримувач" }, { status: 400 });
  }
  const recipient = await prisma.notificationRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient) return NextResponse.json({ error: "Отримувача не знайдено" }, { status: 400 });

  const rule = await prisma.notificationRule.create({
    data: {
      databaseId,
      eventType,
      propertyId: eventType === "page.properties_updated" ? parsePropertyId(body?.propertyId) : null,
      recipientId,
      enabled: body?.enabled == null ? true : Boolean(body.enabled),
    },
  });
  console.log("[notion] додано правило", rule.id);
  return NextResponse.json({ ok: true, rule });
}
