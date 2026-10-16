import { NOTION_API_VERSION, NOTION_DATABASES, findNotionDatabase, normalizeNotionId } from "./constants";
import { getNotionToken } from "./env";
import { kvRead, kvWrite } from "@/lib/kv";

const SCHEMA_TTL_MS = 60 * 60 * 1000;
const SCHEMA_KEY = (databaseId: string) => `notion:schema:v1:${normalizeNotionId(databaseId)}`;
const DATA_SOURCE_INDEX_KEY = "notion:datasource-index";

export class NotionApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "NotionApiError";
    this.status = status;
  }
}

export type NotionSchemaProperty = {
  id: string;
  name: string;
  type: string;
};

export type NotionSchema = {
  databaseId: string;
  fetchedAt: number;
  dataSourceIds: string[];
  properties: NotionSchemaProperty[];
};

type NotionPropertyMap = Record<string, { id?: string; type?: string }>;

async function notionFetch(path: string): Promise<Record<string, unknown>> {
  const token = getNotionToken();
  if (!token) {
    throw new NotionApiError(0, "NOTION_TOKEN не задано");
  }
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
    },
    cache: "no-store",
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message = typeof json?.message === "string" ? json.message : text.slice(0, 300);
    throw new NotionApiError(response.status, `Notion API ${response.status}: ${message}`);
  }
  return json || {};
}

function parseStored<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T | string;
    if (typeof parsed === "string") return JSON.parse(parsed) as T;
    return parsed;
  } catch {
    return null;
  }
}

function propertiesFromMap(map: unknown): NotionSchemaProperty[] {
  if (!map || typeof map !== "object") return [];
  const out: NotionSchemaProperty[] = [];
  for (const [name, value] of Object.entries(map as NotionPropertyMap)) {
    if (!value || typeof value !== "object" || !value.id) continue;
    out.push({ id: value.id, name, type: value.type || "" });
  }
  return out;
}

async function readSchema(databaseId: string): Promise<NotionSchema | null> {
  try {
    const raw = await kvRead.getRaw(SCHEMA_KEY(databaseId));
    const parsed = parseStored<NotionSchema>(raw);
    if (!parsed?.databaseId || !Array.isArray(parsed.properties)) return null;
    return parsed;
  } catch (error) {
    console.error("[notion] не вдалося прочитати кеш схеми", error);
    return null;
  }
}

async function writeSchema(schema: NotionSchema) {
  await kvWrite.setRaw(SCHEMA_KEY(schema.databaseId), JSON.stringify(schema));
}

async function readDataSourceIndex(): Promise<Record<string, string>> {
  try {
    const raw = await kvRead.getRaw(DATA_SOURCE_INDEX_KEY);
    const parsed = parseStored<Record<string, string>>(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeDataSourceIndex(index: Record<string, string>) {
  await kvWrite.setRaw(DATA_SOURCE_INDEX_KEY, JSON.stringify(index));
}

export async function refreshDatabaseSchema(databaseId: string): Promise<NotionSchema> {
  const database = await notionFetch(`/databases/${databaseId}`);
  const dataSources = Array.isArray(database.data_sources) ? database.data_sources : [];
  const dataSourceIds = dataSources
    .map((item) => (item && typeof item === "object" ? String((item as { id?: string }).id || "") : ""))
    .filter(Boolean);

  let properties = propertiesFromMap(database.properties);
  if (properties.length === 0) {
    for (const dataSourceId of dataSourceIds) {
      const source = await notionFetch(`/data_sources/${dataSourceId}`);
      properties = properties.concat(propertiesFromMap(source.properties));
    }
  }

  const schema: NotionSchema = {
    databaseId,
    fetchedAt: Date.now(),
    dataSourceIds,
    properties,
  };
  try {
    await writeSchema(schema);
    const index = await readDataSourceIndex();
    for (const dataSourceId of dataSourceIds) {
      index[normalizeNotionId(dataSourceId)] = databaseId;
    }
    await writeDataSourceIndex(index);
  } catch (error) {
    console.error("[notion] не вдалося зберегти кеш схеми", error);
  }
  return schema;
}

export async function getDatabaseSchema(databaseId: string): Promise<NotionSchema> {
  const cached = await readSchema(databaseId);
  if (cached && Date.now() - cached.fetchedAt < SCHEMA_TTL_MS) return cached;
  return refreshDatabaseSchema(databaseId);
}

export async function invalidateNotionSchemas() {
  try {
    await Promise.all(NOTION_DATABASES.map((db) => kvWrite.setRaw(SCHEMA_KEY(db.id), "")));
    await kvWrite.setRaw(DATA_SOURCE_INDEX_KEY, "");
    console.log("[notion] кеш схем скинуто");
  } catch (error) {
    console.error("[notion] не вдалося скинути кеш схем", error);
  }
}

export async function databaseIdForDataSource(dataSourceId: string): Promise<string | null> {
  const key = normalizeNotionId(dataSourceId);
  const index = await readDataSourceIndex();
  if (index[key]) return index[key];
  if (!getNotionToken()) return null;
  for (const db of NOTION_DATABASES) {
    try {
      const schema = await refreshDatabaseSchema(db.id);
      if (schema.dataSourceIds.some((id) => normalizeNotionId(id) === key)) return db.id;
    } catch (error) {
      console.error("[notion] не вдалося зіставити data source", db.id, error);
    }
  }
  return null;
}

export async function fetchNotionPage(pageId: string): Promise<Record<string, unknown> | null> {
  try {
    return await notionFetch(`/pages/${pageId}`);
  } catch (error) {
    if (error instanceof NotionApiError && (error.status === 404 || error.status === 400)) {
      console.log("[notion] сторінку не знайдено", pageId, error.status);
      return null;
    }
    throw error;
  }
}

export async function resolveOurDatabase(page: Record<string, unknown> | null): Promise<{ id: string; label: string } | null> {
  const parent = (page?.parent && typeof page.parent === "object" ? page.parent : {}) as {
    type?: string;
    database_id?: string;
    data_source_id?: string;
    id?: string;
  };
  const directId = parent.database_id || (parent.type === "database_id" ? parent.id : undefined);
  const direct = findNotionDatabase(directId);
  if (direct) return direct;
  if (directId) return null;

  const dataSourceId = parent.data_source_id || (parent.type === "data_source_id" ? parent.id : undefined);
  if (!dataSourceId) return null;
  const databaseId = await databaseIdForDataSource(dataSourceId);
  return findNotionDatabase(databaseId);
}
