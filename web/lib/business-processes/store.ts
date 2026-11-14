// Збереження бізнес-процесів: процес + версії налаштувань.
// Зміна налаштувань — нова версія; назва, опис і вмикання пишуться в сам процес.

import { prisma } from "@/lib/prisma";
import {
  normalizeProcessConfig,
  PROCESS_KINDS,
  validateProcess,
  type BusinessProcessConfig,
  type ProcessKind,
} from "./config";

export type BusinessProcessRow = {
  id: string;
  title: string;
  description: string | null;
  kind: ProcessKind;
  isActive: boolean;
  version: number;
  config: BusinessProcessConfig;
  updatedAt: string;
};

export type ProcessTeamMember = {
  id: string;
  name: string;
  role: string;
  /** Бот зможе надсилати завдання лише людям із Telegram. */
  hasTelegram: boolean;
};

function asKind(v: unknown): ProcessKind {
  return PROCESS_KINDS.includes(v as ProcessKind) ? (v as ProcessKind) : "task_report";
}

type ProcessWithVersions = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  isActive: boolean;
  currentVersion: number;
  updatedAt: Date;
  versions: { version: number; config: unknown }[];
};

function toRow(p: ProcessWithVersions): BusinessProcessRow {
  const kind = asKind(p.kind);
  const current = p.versions.find((v) => v.version === p.currentVersion) ?? p.versions[0];
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    kind,
    isActive: p.isActive,
    version: current?.version ?? p.currentVersion,
    config: normalizeProcessConfig(current?.config, kind),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const withCurrentVersion = {
  versions: { orderBy: { version: "desc" as const }, take: 1, select: { version: true, config: true } },
};

/** Список процесів і людей Команди для форми. Запитів: 2. */
export async function listBusinessProcesses(): Promise<{
  processes: BusinessProcessRow[];
  members: ProcessTeamMember[];
}> {
  const [processes, members] = await Promise.all([
    prisma.businessProcess.findMany({
      orderBy: [{ isActive: "desc" }, { title: "asc" }],
      include: withCurrentVersion,
    }),
    prisma.teamMember.findMany({
      where: { hiddenAt: null },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, salonRole: true, telegramChatId: true },
    }),
  ]);
  return {
    processes: processes.map(toRow),
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.salonRole,
      hasTelegram: m.telegramChatId != null,
    })),
  };
}

export type SaveProcessInput = {
  title?: unknown;
  description?: unknown;
  kind?: unknown;
  isActive?: unknown;
  config?: unknown;
};

function prepare(input: SaveProcessInput, fallbackKind?: ProcessKind) {
  const kind = input.kind != null ? asKind(input.kind) : fallbackKind ?? "task_report";
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 200) : "";
  const description =
    typeof input.description === "string" && input.description.trim() ? input.description.trim().slice(0, 2000) : null;
  const config = normalizeProcessConfig(input.config, kind);
  const errors = validateProcess({ title, kind, config });
  if (errors.length > 0) throw new Error(errors.join("; "));
  return { kind, title, description, config };
}

/** Новий процес — версія 1. Запитів: 1 (процес разом із версією). */
export async function createBusinessProcess(input: SaveProcessInput, createdBy: string | null) {
  const { kind, title, description, config } = prepare(input);
  const created = await prisma.businessProcess.create({
    data: {
      title,
      description,
      kind,
      isActive: input.isActive === true,
      currentVersion: 1,
      createdBy,
      versions: { create: { version: 1, config, createdBy } },
    },
    include: withCurrentVersion,
  });
  console.log(`[business-processes] Створено процес «${title}» (${kind}) id=${created.id}`);
  return toRow(created);
}

/**
 * Оновлення. Налаштування змінились — нова версія (старі завдання лишаються на своїй).
 * Тип процесу після створення не змінюємо: від нього залежить форма звіту.
 * Запитів: 2–3.
 */
export async function updateBusinessProcess(id: string, input: SaveProcessInput, createdBy: string | null) {
  const existing = await prisma.businessProcess.findUnique({ where: { id }, include: withCurrentVersion });
  if (!existing) throw new Error("Процес не знайдено");
  const kind = asKind(existing.kind);
  const { title, description, config } = prepare({ ...input, kind }, kind);
  const current = existing.versions[0];
  const configChanged = JSON.stringify(normalizeProcessConfig(current?.config, kind)) !== JSON.stringify(config);
  const nextVersion = (current?.version ?? existing.currentVersion) + 1;

  const updated = await prisma.businessProcess.update({
    where: { id },
    data: {
      title,
      description,
      isActive: typeof input.isActive === "boolean" ? input.isActive : existing.isActive,
      ...(configChanged
        ? { currentVersion: nextVersion, versions: { create: { version: nextVersion, config, createdBy } } }
        : {}),
    },
    include: withCurrentVersion,
  });
  console.log(
    `[business-processes] Оновлено «${title}» id=${id}${configChanged ? ` → версія ${nextVersion}` : " (без зміни налаштувань)"}`,
  );
  return toRow(updated);
}

/** Лише вмикання/вимикання. Запитів: 1. */
export async function setBusinessProcessActive(id: string, isActive: boolean) {
  const updated = await prisma.businessProcess.update({
    where: { id },
    data: { isActive },
    include: withCurrentVersion,
  });
  console.log(`[business-processes] «${updated.title}» ${isActive ? "увімкнено" : "вимкнено"}`);
  return toRow(updated);
}

/** Видалення разом із версіями. Поки завдань немає — безпечно. Запитів: 1. */
export async function deleteBusinessProcess(id: string) {
  const deleted = await prisma.businessProcess.delete({ where: { id }, select: { title: true } });
  console.log(`[business-processes] Видалено процес «${deleted.title}» id=${id}`);
}
