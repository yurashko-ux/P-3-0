import { findNotionDatabase } from "./constants";

const EVENT_TYPES = ["*", "page.created", "page.properties_updated", "page.deleted", "page.undeleted"] as const;

export function parseChatId(raw: unknown): bigint | null {
  const value = String(raw ?? "").trim();
  if (!/^-?\d{1,20}$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function parseEventType(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return (EVENT_TYPES as readonly string[]).includes(value) ? value : null;
}

export function parseDatabaseId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (value === "*") return "*";
  return findNotionDatabase(value)?.id ?? null;
}

export function parsePropertyId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return value ? value.slice(0, 200) : null;
}
