// Стартовий розділ посади: куди потрапляє користувач після входу.

export const START_SECTIONS = [
  { id: "direct", label: "Direct", path: "/admin/direct" },
  { id: "clients", label: "Клієнти", path: "/admin/direct/inactive-base" },
  { id: "lead-sources", label: "Джерела лідів", path: "/admin/direct/stats/leads" },
  { id: "leads", label: "Ліди", path: "/admin/direct/stats/consultations" },
  { id: "stats", label: "Статистика", path: "/admin/direct/stats" },
  { id: "finance", label: "Фінанси", path: "/admin/finance" },
  { id: "lead-operations", label: "Операції лідів", path: "/admin/finance/operations" },
  { id: "finance-report", label: "Фінансовий звіт", path: "/admin/finance-report" },
  { id: "cash", label: "Каса", path: "/admin/finance/kasa" },
  { id: "warehouse", label: "Склад", path: "/admin/warehouse" },
  { id: "journal", label: "Журнал", path: "/admin/journal" },
  { id: "team", label: "Команда", path: "/admin/team" },
  { id: "bank", label: "Банк", path: "/admin/bank" },
  { id: "campaigns", label: "Кампанії", path: "/admin/campaigns" },
  { id: "admin", label: "Адмін-панель", path: "/admin" },
] as const;

export type StartSectionId = (typeof START_SECTIONS)[number]["id"];

export const DEFAULT_START_SECTION: StartSectionId = "direct";

export function parseStartSection(value: unknown): StartSectionId {
  if (typeof value === "string" && START_SECTIONS.some((section) => section.id === value)) {
    return value as StartSectionId;
  }
  return DEFAULT_START_SECTION;
}

export function startSectionPath(id: StartSectionId): string {
  return START_SECTIONS.find((section) => section.id === id)?.path ?? "/admin/direct";
}

/** Читає startSection із JSON посади. Якщо ключа немає — Direct, як раніше. */
export function readStartSection(stored: unknown): StartSectionId {
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    return parseStartSection((stored as Record<string, unknown>).startSection);
  }
  return DEFAULT_START_SECTION;
}
