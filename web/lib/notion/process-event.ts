import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kvRead, kvWrite } from "@/lib/kv";
import {
  databaseLabel,
  findNotionDatabase,
  NOTION_PAGE_EVENTS,
  type NotionPageEventType,
} from "./constants";
import { fetchNotionPage, invalidateNotionSchemas, resolveOurDatabase } from "./client";
import { getDefaultTelegramChatId } from "./env";
import {
  diffTaskState,
  extractTaskState,
  formatCreated,
  formatDeleted,
  formatFieldChange,
  formatRestored,
  type TaskState,
} from "./messages";
import { sendNotionTelegram } from "./notify";
import { decodePropertyId } from "./signature";

const VERIFICATION_KEY = "notion:webhook:verification_token";

export type NotionWebhookPayload = {
  id?: string;
  timestamp?: string;
  type?: string;
  verification_token?: string;
  entity?: { id?: string; type?: string };
  data?: {
    updated_properties?: unknown;
    parent?: { id?: string; type?: string; database_id?: string };
  };
};

type OutgoingMessage = {
  text: string;
  propertyId: string | null;
};

type RuleRow = {
  databaseId: string;
  eventType: string;
  propertyId: string | null;
  enabled: boolean;
  recipient: { telegramChatId: bigint; enabled: boolean };
};

export async function saveVerificationToken(token: string) {
  await kvWrite.setRaw(VERIFICATION_KEY, token);
  console.log("[notion] verification_token збережено в KV");
}

export async function readVerificationToken(): Promise<string | null> {
  try {
    const raw = await kvRead.getRaw(VERIFICATION_KEY);
    const value = (raw || "").trim();
    return value || null;
  } catch (error) {
    console.error("[notion] не вдалося прочитати verification_token", error);
    return null;
  }
}

function isPageEvent(type: string): type is NotionPageEventType {
  return (NOTION_PAGE_EVENTS as readonly string[]).includes(type);
}

function eventTime(payload: NotionWebhookPayload): Date | null {
  if (!payload.timestamp) return null;
  const ms = Date.parse(payload.timestamp);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function updatedPropertyIds(payload: NotionWebhookPayload): string[] | null {
  const raw = payload.data?.updated_properties;
  if (!Array.isArray(raw)) return null;
  return raw.map((item) => decodePropertyId(String(item))).filter(Boolean);
}

function parentDatabaseHint(payload: NotionWebhookPayload): string | null {
  const parent = payload.data?.parent;
  if (!parent) return null;
  return parent.database_id || parent.id || null;
}

function sameDatabase(ruleDatabaseId: string, databaseId: string): boolean {
  if (ruleDatabaseId === "*") return true;
  const ruleDb = findNotionDatabase(ruleDatabaseId);
  const eventDb = findNotionDatabase(databaseId);
  if (ruleDb && eventDb) return ruleDb.id === eventDb.id;
  return ruleDatabaseId === databaseId;
}

function chatsForMessage(
  rules: RuleRow[],
  databaseId: string,
  eventType: string,
  propertyId: string | null,
): bigint[] {
  const seen = new Set<string>();
  const chats: bigint[] = [];
  for (const rule of rules) {
    if (!rule.enabled || !rule.recipient.enabled) continue;
    if (!sameDatabase(rule.databaseId, databaseId)) continue;
    if (rule.eventType !== "*" && rule.eventType !== eventType) continue;
    if (eventType === "page.properties_updated" && rule.propertyId && rule.propertyId !== propertyId) {
      continue;
    }
    const key = rule.recipient.telegramChatId.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    chats.push(rule.recipient.telegramChatId);
  }
  return chats;
}

async function deliver(messages: OutgoingMessage[], rules: RuleRow[], databaseId: string, eventType: string) {
  const ruleCount = await prisma.notificationRule.count();
  const fallback = ruleCount === 0 ? getDefaultTelegramChatId() : null;
  let sent = 0;
  const errors: string[] = [];
  for (const message of messages) {
    const chats = fallback
      ? [fallback]
      : chatsForMessage(rules, databaseId, eventType, message.propertyId);
    for (const chatId of chats) {
      try {
        await sendNotionTelegram(chatId, message.text);
        sent += 1;
      } catch (error) {
        const text = error instanceof Error ? error.message : "помилка Telegram";
        errors.push(`${chatId.toString()}: ${text}`);
        console.error("[notion] не вдалося надіслати сповіщення", chatId.toString(), text);
      }
    }
  }
  if (errors.length) {
    throw new Error(errors.join("; ").slice(0, 1000));
  }
  return sent;
}

async function saveSnapshot(pageId: string, databaseId: string, state: TaskState, notionUpdatedAt: Date | null) {
  await prisma.notionPageSnapshot.upsert({
    where: { pageId },
    create: {
      pageId,
      databaseId,
      title: state.title,
      status: state.status,
      assignee: state.assignee,
      deadline: state.deadline,
      notionUpdatedAt,
    },
    update: {
      databaseId,
      title: state.title,
      status: state.status,
      assignee: state.assignee,
      deadline: state.deadline,
      notionUpdatedAt,
    },
  });
}

function snapshotState(row: { title: string; status: string; assignee: string; deadline: string } | null): TaskState | null {
  if (!row) return null;
  return {
    title: row.title,
    status: row.status,
    assignee: row.assignee,
    deadline: row.deadline,
  };
}

async function finish(
  id: string,
  status: "processed" | "skipped" | "failed",
  extra: { error?: string | null; databaseId?: string | null; pageId?: string | null; sent?: number },
) {
  await prisma.notionWebhookEvent.update({
    where: { id },
    data: {
      status,
      error: extra.error ?? null,
      databaseId: extra.databaseId,
      pageId: extra.pageId,
      processedAt: new Date(),
    },
  });
  console.log("[notion] подію завершено", { id, status, sent: extra.sent ?? 0, error: extra.error || undefined });
}

export async function processNotionWebhookEvent(rowId: string) {
  const claimed = await prisma.notionWebhookEvent.updateMany({
    where: { id: rowId, status: "pending" },
    data: { status: "processing" },
  });
  if (claimed.count !== 1) {
    console.log("[notion] подію вже взято в обробку", rowId);
    return;
  }

  const row = await prisma.notionWebhookEvent.findUnique({ where: { id: rowId } });
  if (!row) return;
  const payload = row.payload as NotionWebhookPayload;

  try {
    if (payload.type === "data_source.schema_updated") {
      await invalidateNotionSchemas();
      await finish(rowId, "processed", { pageId: row.pageId });
      return;
    }

    if (!payload.type || !isPageEvent(payload.type)) {
      await finish(rowId, "skipped", { error: "Подія не зі списку задач", pageId: row.pageId });
      return;
    }

    const pageId = payload.entity?.id || row.pageId || "";
    if (!pageId) {
      await finish(rowId, "skipped", { error: "У події немає id сторінки" });
      return;
    }

    const snapshot = await prisma.notionPageSnapshot.findUnique({ where: { pageId } });
    const happenedAt = eventTime(payload);
    const stale = Boolean(
      snapshot?.notionUpdatedAt && happenedAt && happenedAt.getTime() < snapshot.notionUpdatedAt.getTime(),
    );
    if (stale && payload.type === "page.properties_updated") {
      await finish(rowId, "skipped", {
        error: "Застаріла подія",
        pageId,
        databaseId: snapshot?.databaseId,
      });
      return;
    }

    const rules = await prisma.notificationRule.findMany({
      where: { enabled: true, recipient: { enabled: true } },
      include: { recipient: true },
    });

    if (payload.type === "page.deleted") {
      const page = await fetchNotionPage(pageId);
      const fromPage = page ? await resolveOurDatabase(page) : null;
      if (page && !fromPage) {
        await finish(rowId, "skipped", { error: "Сторінка не з наших баз", pageId });
        return;
      }
      const database = fromPage || findNotionDatabase(snapshot?.databaseId) || findNotionDatabase(parentDatabaseHint(payload));
      if (!database) {
        await finish(rowId, "skipped", { error: "Сторінка не з наших баз", pageId });
        return;
      }
      const title = snapshot?.title || "";
      const sent = await deliver(
        [{ text: formatDeleted(database.label, title), propertyId: null }],
        rules,
        database.id,
        payload.type,
      );
      await finish(rowId, "processed", { pageId, databaseId: database.id, sent });
      return;
    }

    const page = await fetchNotionPage(pageId);
    if (!page) {
      await finish(rowId, "failed", { error: "Notion не повернув сторінку", pageId, databaseId: snapshot?.databaseId });
      return;
    }
    const database = await resolveOurDatabase(page);
    if (!database) {
      await finish(rowId, "skipped", { error: "Сторінка не з наших баз", pageId });
      return;
    }

    const properties = (page.properties && typeof page.properties === "object" ? page.properties : {}) as Record<string, never>;
    const extracted = extractTaskState(properties);
    const label = databaseLabel(database.id);

    let messages: OutgoingMessage[] = [];
    if (payload.type === "page.created") {
      messages = [{ text: formatCreated(label, extracted.state), propertyId: null }];
    } else if (payload.type === "page.undeleted") {
      messages = [{ text: formatRestored(label, extracted.state.title), propertyId: null }];
    } else {
      const changes = diffTaskState(
        snapshotState(snapshot),
        extracted.state,
        extracted.ids,
        updatedPropertyIds(payload),
      );
      messages = changes.map((change) => ({
        text: formatFieldChange(label, extracted.state.title, change),
        propertyId: change.propertyId,
      }));
    }

    const sent = messages.length
      ? await deliver(messages, rules, database.id, payload.type)
      : 0;
    if (!stale) {
      await saveSnapshot(pageId, database.id, extracted.state, happenedAt);
    }
    await finish(rowId, "processed", { pageId, databaseId: database.id, sent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Помилка обробки події Notion";
    console.error("[notion] обробка події впала", rowId, message);
    await finish(rowId, "failed", { error: message.slice(0, 1000), pageId: row.pageId, databaseId: row.databaseId });
  }
}

export async function processPendingNotionEvents() {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
  const released = await prisma.notionWebhookEvent.updateMany({
    where: { status: "processing", updatedAt: { lt: fiveMinutesAgo } },
    data: { status: "pending" },
  });
  if (released.count) {
    console.log("[notion] повернуто завислі події в чергу", released.count);
  }

  const rows = await prisma.notionWebhookEvent.findMany({
    where: { status: "pending", createdAt: { lt: oneMinuteAgo } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  rows.sort((a, b) => {
    const ta = Date.parse(String((a.payload as NotionWebhookPayload)?.timestamp || "")) || a.createdAt.getTime();
    const tb = Date.parse(String((b.payload as NotionWebhookPayload)?.timestamp || "")) || b.createdAt.getTime();
    return ta - tb;
  });
  for (const row of rows) {
    await processNotionWebhookEvent(row.id);
  }
  return rows.length;
}

export function asPayload(value: unknown): NotionWebhookPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as NotionWebhookPayload;
}

export function payloadJson(payload: NotionWebhookPayload): Prisma.InputJsonValue {
  return payload as Prisma.InputJsonValue;
}
