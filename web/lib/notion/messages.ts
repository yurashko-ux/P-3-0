import { MARKETING_PROPERTY_IDS, TRACKED_FIELD_NAMES } from "./constants";

export type TaskState = {
  title: string;
  status: string;
  assignee: string;
  deadline: string;
};

export type TrackedPropertyIds = {
  status: string | null;
  assignee: string | null;
  deadline: string | null;
};

export type FieldChange = {
  kind: "status" | "assignee" | "deadline";
  propertyId: string | null;
  before: string;
  after: string;
};

type NotionProperty = {
  id?: string;
  type?: string;
  title?: { plain_text?: string }[];
  rich_text?: { plain_text?: string }[];
  status?: { name?: string } | null;
  select?: { name?: string } | null;
  multi_select?: { name?: string }[];
  people?: { name?: string; id?: string }[];
  date?: { start?: string } | null;
  checkbox?: boolean;
  number?: number | null;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  formula?: { type?: string; string?: string | null; number?: number | null; boolean?: boolean | null; date?: { start?: string } | null };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainList(items: { plain_text?: string }[] | undefined): string {
  if (!Array.isArray(items)) return "";
  return items.map((item) => item?.plain_text || "").join("").trim();
}

function readPropertyValue(prop: NotionProperty | undefined): string {
  if (!prop) return "";
  switch (prop.type) {
    case "title":
      return plainList(prop.title);
    case "rich_text":
      return plainList(prop.rich_text);
    case "status":
      return prop.status?.name || "";
    case "select":
      return prop.select?.name || "";
    case "multi_select":
      return (prop.multi_select || []).map((item) => item?.name || "").filter(Boolean).join(", ");
    case "people":
      return (prop.people || []).map((person) => person?.name || "").filter(Boolean).join(", ");
    case "date":
      return prop.date?.start || "";
    case "checkbox":
      return prop.checkbox ? "так" : "ні";
    case "number":
      return prop.number == null ? "" : String(prop.number);
    case "url":
      return prop.url || "";
    case "email":
      return prop.email || "";
    case "phone_number":
      return prop.phone_number || "";
    case "formula": {
      const formula = prop.formula;
      if (!formula) return "";
      if (formula.type === "string") return formula.string || "";
      if (formula.type === "number") return formula.number == null ? "" : String(formula.number);
      if (formula.type === "boolean") return formula.boolean ? "так" : "ні";
      if (formula.type === "date") return formula.date?.start || "";
      return "";
    }
    default:
      return "";
  }
}

function findById(properties: Record<string, any>, id: string): NotionProperty | undefined {
  return Object.values(properties).find((prop) => prop?.id === id);
}

function findByName(properties: Record<string, any>, name: string): NotionProperty | undefined {
  if (properties[name]) return properties[name];
  const target = name.trim().toLowerCase();
  for (const [key, prop] of Object.entries(properties)) {
    if (key.trim().toLowerCase() === target) return prop;
  }
  return undefined;
}

function pickField(
  properties: Record<string, any>,
  name: string,
  knownId: string,
): NotionProperty | undefined {
  return findById(properties, knownId) || findByName(properties, name);
}

export function emptyTaskState(): TaskState {
  return { title: "", status: "", assignee: "", deadline: "" };
}

export function extractTaskState(properties: Record<string, any> | null | undefined): {
  state: TaskState;
  ids: TrackedPropertyIds;
} {
  const props = properties || {};
  const titleProp = Object.values(props).find((prop) => prop?.type === "title");
  const statusProp = pickField(props, TRACKED_FIELD_NAMES.status, MARKETING_PROPERTY_IDS.status);
  const assigneeProp = pickField(props, TRACKED_FIELD_NAMES.assignee, MARKETING_PROPERTY_IDS.assignee);
  const deadlineProp = pickField(props, TRACKED_FIELD_NAMES.deadline, MARKETING_PROPERTY_IDS.deadline);
  return {
    state: {
      title: readPropertyValue(titleProp),
      status: readPropertyValue(statusProp),
      assignee: readPropertyValue(assigneeProp),
      deadline: readPropertyValue(deadlineProp),
    },
    ids: {
      status: statusProp?.id ?? null,
      assignee: assigneeProp?.id ?? null,
      deadline: deadlineProp?.id ?? null,
    },
  };
}

function show(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return trimmed;
}

function titleOf(state: TaskState): string {
  return show(state.title) === "—" ? "без назви" : show(state.title);
}

export function diffTaskState(
  before: TaskState | null,
  after: TaskState,
  ids: TrackedPropertyIds,
  updatedPropertyIds: string[] | null,
): FieldChange[] {
  const previous = before || emptyTaskState();
  const candidates: FieldChange[] = [
    { kind: "status", propertyId: ids.status, before: previous.status, after: after.status },
    { kind: "assignee", propertyId: ids.assignee, before: previous.assignee, after: after.assignee },
    { kind: "deadline", propertyId: ids.deadline, before: previous.deadline, after: after.deadline },
  ];
  return candidates.filter((change) => {
    if (show(change.before) === show(change.after)) return false;
    if (!updatedPropertyIds) return true;
    if (!change.propertyId) return true;
    return updatedPropertyIds.includes(change.propertyId);
  });
}

export function formatCreated(label: string, state: TaskState): string {
  return `➕ [${escapeHtml(label)}] Нова задача: ${escapeHtml(titleOf(state))} — ${escapeHtml(show(state.assignee))} (дедлайн: ${escapeHtml(show(state.deadline))})`;
}

export function formatFieldChange(label: string, title: string, change: FieldChange): string {
  const name = escapeHtml(titleOf({ ...emptyTaskState(), title }));
  const before = escapeHtml(show(change.before));
  const after = escapeHtml(show(change.after));
  if (change.kind === "assignee") {
    return `👤 [${escapeHtml(label)}] ${name}: відповідальний ${before} → ${after}`;
  }
  if (change.kind === "status") {
    return `🔁 [${escapeHtml(label)}] ${name}: статус ${before} → ${after}`;
  }
  return `📅 [${escapeHtml(label)}] ${name}: дедлайн ${before} → ${after}`;
}

export function formatDeleted(label: string, title: string): string {
  return `🗑 [${escapeHtml(label)}] Задачу видалено: ${escapeHtml(titleOf({ ...emptyTaskState(), title }))}`;
}

export function formatRestored(label: string, title: string): string {
  return `♻️ [${escapeHtml(label)}] Задачу відновлено: ${escapeHtml(titleOf({ ...emptyTaskState(), title }))}`;
}
