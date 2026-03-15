// web/lib/permissions-default.ts
// Default permissions для нової функції (всі edit = все доступно)

import type { Permissions, PermissionKey } from "./auth-rbac";

export const PERMISSION_CATEGORIES: { key: PermissionKey; label: string }[] = [
  { key: "finances", label: "Фінанси (кошти, оплати, суми)" },
  { key: "salesColumn", label: "Колонка Продажі" },
  { key: "actionsColumn", label: "Колонка Дії" },
  { key: "instCreateStatuses", label: "INST: створювати статуси" },
  { key: "callsListen", label: "Дзвінки: прослуховування" },
  { key: "statusesCreateSubsection", label: 'Розділ "+" Створювати статуси' },
  { key: "phoneOutgoingCalls", label: "Телефон: вихідні дзвінки" },
  { key: "statsSection", label: "Розділ Статистика" },
  { key: "financeReportSection", label: "Розділ Фінансовий звіт" },
  { key: "debugSection", label: "Розділ Тести" },
  { key: "accessSection", label: "Розділ Доступи" },
];

export const DEFAULT_PERMISSIONS: Permissions = {
  finances: "edit",
  salesColumn: "edit",
  actionsColumn: "edit",
  instCreateStatuses: "edit",
  callsListen: "edit",
  statusesCreateSubsection: "edit",
  phoneOutgoingCalls: "edit",
  statsSection: "edit",
  financeReportSection: "edit",
  debugSection: "edit",
  accessSection: "edit",
};
