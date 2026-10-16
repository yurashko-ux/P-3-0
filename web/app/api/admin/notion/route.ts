import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  MARKETING_PROPERTIES,
  NOTION_DATABASES,
  NOTION_EVENT_LABELS,
  NOTION_WEBHOOK_URL,
} from "@/lib/notion/constants";
import { notionEnvFlags } from "@/lib/notion/env";
import { getDatabaseSchema } from "@/lib/notion/client";
import { readVerificationToken } from "@/lib/notion/process-event";
import { requireNotionSection } from "@/lib/notion/require-auth";
import { canEdit } from "@/lib/auth-rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

async function loadNotionOverview() {
  const [recipients, rules, events, verificationToken] = await Promise.all([
    prisma.notificationRecipient.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.notificationRule.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.notionWebhookEvent.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    readVerificationToken(),
  ]);

  const properties: { id: string; name: string; databaseId: string }[] = MARKETING_PROPERTIES.map((item) => ({
    ...item,
    databaseId: NOTION_DATABASES[0].id,
  }));
  const seen = new Set(properties.map((item) => `${item.databaseId}:${item.id}`));

  if (notionEnvFlags().notionToken) {
    for (const database of NOTION_DATABASES) {
      try {
        const schema = await getDatabaseSchema(database.id);
        for (const property of schema.properties) {
          const key = `${database.id}:${property.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          properties.push({ id: property.id, name: property.name, databaseId: database.id });
        }
      } catch (error) {
        console.error("[notion] не вдалося завантажити схему для панелі", database.id, error);
      }
    }
  }

  return {
    webhookUrl: NOTION_WEBHOOK_URL,
    env: notionEnvFlags(),
    verificationToken,
    databases: NOTION_DATABASES.map((database) => ({ id: database.id, label: database.label })),
    eventLabels: NOTION_EVENT_LABELS,
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      telegramChatId: recipient.telegramChatId.toString(),
      enabled: recipient.enabled,
    })),
    rules: rules.map((rule) => ({
      id: rule.id,
      databaseId: rule.databaseId,
      eventType: rule.eventType,
      propertyId: rule.propertyId,
      recipientId: rule.recipientId,
      enabled: rule.enabled,
    })),
    properties,
    events: events.map((event) => ({
      id: event.id,
      notionEventId: event.notionEventId,
      eventType: event.eventType,
      pageId: event.pageId,
      databaseId: event.databaseId,
      status: event.status,
      error: event.error,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function GET(req: Request) {
  const auth = await requireNotionSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const overview = await loadNotionOverview();
    return NextResponse.json({
      ok: true,
      canEdit: canEdit(auth.permissions, "notionSection"),
      ...overview,
    });
  } catch (error) {
    console.error("[notion] не вдалося зібрати огляд", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося завантажити розділ Notion" },
      { status: 500 },
    );
  }
}
