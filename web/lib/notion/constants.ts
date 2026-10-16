// Довідник баз Notion і подій, які вміє розсилати CRM.

export const NOTION_WEBHOOK_URL = "https://p-3-0.vercel.app/api/notion/webhook";

export const NOTION_API_VERSION = "2025-09-03";

export const NOTION_DATABASES = [
  {
    id: "d98da367-aff6-4803-b829-e3971c4e3ae0",
    label: "Маркетинг",
  },
  {
    id: "65fd4659-04e0-492d-9f90-018797ada4d1",
    label: "Операційні",
  },
] as const;

export type NotionDatabase = (typeof NOTION_DATABASES)[number];

/** Відомі id полів бази «Задачі маркетингу» (вже URL-decoded). */
export const MARKETING_PROPERTY_IDS = {
  status: "jo~Z",
  assignee: "srM<",
  deadline: "\\B_j",
  initiator: "i<yt",
  direction: "x_Tl",
} as const;

export const MARKETING_PROPERTIES: { id: string; name: string }[] = [
  { id: MARKETING_PROPERTY_IDS.status, name: "Статус" },
  { id: MARKETING_PROPERTY_IDS.assignee, name: "Відповідальний" },
  { id: MARKETING_PROPERTY_IDS.deadline, name: "Дедлайн" },
  { id: MARKETING_PROPERTY_IDS.initiator, name: "Ініціатор" },
  { id: MARKETING_PROPERTY_IDS.direction, name: "Напрямок" },
];

export const NOTION_PAGE_EVENTS = [
  "page.created",
  "page.properties_updated",
  "page.deleted",
  "page.undeleted",
] as const;

export type NotionPageEventType = (typeof NOTION_PAGE_EVENTS)[number];

export const NOTION_EVENT_LABELS: Record<string, string> = {
  "*": "Усі події",
  "page.created": "Нова задача",
  "page.properties_updated": "Зміна поля",
  "page.deleted": "Видалення",
  "page.undeleted": "Відновлення",
};

export const TRACKED_FIELD_NAMES = {
  status: "Статус",
  assignee: "Відповідальний",
  deadline: "Дедлайн",
} as const;

export function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").trim().toLowerCase();
}

export function findNotionDatabase(id: string | null | undefined): NotionDatabase | null {
  if (!id) return null;
  const normalized = normalizeNotionId(id);
  return NOTION_DATABASES.find((db) => normalizeNotionId(db.id) === normalized) ?? null;
}

export function databaseLabel(databaseId: string | null | undefined): string {
  if (!databaseId || databaseId === "*") return "Усі бази";
  return findNotionDatabase(databaseId)?.label ?? databaseId;
}
