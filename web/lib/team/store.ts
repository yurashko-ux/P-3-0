// Команда: довідник людей і схем нарахування ЗП.

import { prisma } from "@/lib/prisma";
import { listJournalStaffFromAltegio } from "@/lib/journal/staff";
import { Prisma } from "@prisma/client";
import {
  TEAM_PAY_KINDS,
  TEAM_SALON_ROLES,
  TYPICAL_SCHEMES,
  type TeamPayKind,
  type TeamSalonRole,
} from "@/lib/team/constants";

export { TEAM_PAY_KINDS, TEAM_SALON_ROLES, TYPICAL_SCHEMES };
export type { TeamPayKind, TeamSalonRole };

function isSalonRole(v: unknown): v is TeamSalonRole {
  return typeof v === "string" && (TEAM_SALON_ROLES as readonly string[]).includes(v);
}

function isPayKind(v: unknown): v is TeamPayKind {
  return typeof v === "string" && (TEAM_PAY_KINDS as readonly string[]).includes(v);
}

function salonRoleFromAltegio(positionKind: string): TeamSalonRole {
  if (positionKind === "master") return "master";
  if (positionKind === "assistant") return "assistant";
  if (positionKind === "admin") return "admin";
  return "other";
}

const memberInclude = {
  payScheme: true,
  directMaster: { select: { id: true, name: true, role: true, altegioStaffId: true } },
  appUser: { select: { id: true, name: true, login: true } },
} as const;

/** BigInt telegramChatId → string для JSON. */
function serializeMember<T extends { telegramChatId?: bigint | null }>(m: T) {
  return {
    ...m,
    telegramChatId: m.telegramChatId != null ? m.telegramChatId.toString() : null,
  };
}

export async function listTeamMembers() {
  const rows = await prisma.teamMember.findMany({
    include: memberInclude,
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
  return rows.map(serializeMember);
}

export async function listTeamSchemes() {
  return prisma.teamPayScheme.findMany({
    orderBy: [{ isActive: "desc" }, { title: "asc" }],
  });
}

export async function listLinkOptions() {
  const [masters, users, linked] = await Promise.all([
    prisma.directMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true, role: true, altegioStaffId: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.appUser.findMany({
      where: { isActive: true },
      select: { id: true, name: true, login: true },
      orderBy: { name: "asc" },
    }),
    prisma.teamMember.findMany({
      select: { id: true, directMasterId: true, appUserId: true },
    }),
  ]);
  const usedMaster = new Set(linked.map((m) => m.directMasterId).filter(Boolean));
  const usedUser = new Set(linked.map((m) => m.appUserId).filter(Boolean));
  return {
    masters: masters.map((m) => ({ ...m, linked: usedMaster.has(m.id) })),
    users: users.map((u) => ({ ...u, linked: usedUser.has(u.id) })),
  };
}

export type TeamMemberInput = {
  name: string;
  salonRole?: string;
  altegioStaffId?: number | null;
  directMasterId?: string | null;
  appUserId?: string | null;
  paySchemeId?: string | null;
  phone?: string | null;
  telegramUsername?: string | null;
  telegramChatId?: number | string | null;
  isActive?: boolean;
  order?: number;
};

function normalizeMemberData(input: TeamMemberInput) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Вкажіть імʼя");
  const salonRole = isSalonRole(input.salonRole) ? input.salonRole : "other";
  const altegioStaffId =
    input.altegioStaffId != null && Number(input.altegioStaffId) > 0 ? Number(input.altegioStaffId) : null;
  const directMasterId = input.directMasterId ? String(input.directMasterId) : null;
  const appUserId = input.appUserId ? String(input.appUserId) : null;
  const paySchemeId = input.paySchemeId ? String(input.paySchemeId) : null;
  let telegramChatId: bigint | null = null;
  if (input.telegramChatId != null && String(input.telegramChatId).trim() !== "") {
    try {
      telegramChatId = BigInt(String(input.telegramChatId).trim());
    } catch {
      throw new Error("Некоректний Telegram chat ID");
    }
  }
  return {
    name,
    salonRole,
    altegioStaffId,
    directMasterId,
    appUserId,
    paySchemeId,
    phone: input.phone ? String(input.phone).trim() || null : null,
    telegramUsername: input.telegramUsername ? String(input.telegramUsername).replace(/^@/, "").trim() || null : null,
    telegramChatId,
    isActive: input.isActive !== false,
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
  };
}

export async function createTeamMember(input: TeamMemberInput) {
  const data = normalizeMemberData(input);
  const created = await prisma.teamMember.create({ data, include: memberInclude });
  console.log(`[team] Створено людину ${created.id} «${created.name}» role=${created.salonRole}`);
  return serializeMember(created);
}

export async function updateTeamMember(id: string, input: TeamMemberInput) {
  const data = normalizeMemberData(input);
  const updated = await prisma.teamMember.update({ where: { id }, data, include: memberInclude });
  console.log(`[team] Оновлено людину ${id}`);
  return serializeMember(updated);
}

export async function deleteTeamMember(id: string) {
  await prisma.teamMember.delete({ where: { id } });
  console.log(`[team] Видалено людину ${id}`);
}

export type TeamSchemeInput = {
  title: string;
  kind: string;
  params?: Record<string, unknown>;
  isActive?: boolean;
};

export async function createTeamScheme(input: TeamSchemeInput) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Вкажіть назву схеми");
  if (!isPayKind(input.kind)) throw new Error("Невідомий тип схеми");
  const created = await prisma.teamPayScheme.create({
    data: {
      title,
      kind: input.kind,
      params: (input.params || {}) as Prisma.InputJsonValue,
      isActive: input.isActive !== false,
    },
  });
  console.log(`[team] Створено схему ${created.id} «${created.title}» kind=${created.kind}`);
  return created;
}

export async function updateTeamScheme(id: string, input: TeamSchemeInput) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Вкажіть назву схеми");
  if (!isPayKind(input.kind)) throw new Error("Невідомий тип схеми");
  return prisma.teamPayScheme.update({
    where: { id },
    data: {
      title,
      kind: input.kind,
      params: (input.params || {}) as Prisma.InputJsonValue,
      isActive: input.isActive !== false,
    },
  });
}

export async function deleteTeamScheme(id: string) {
  const inUse = await prisma.teamMember.count({ where: { paySchemeId: id } });
  if (inUse > 0) {
    throw new Error(`Схему призначено ${inUse} людям — спочатку зніміть привʼязку`);
  }
  await prisma.teamPayScheme.delete({ where: { id } });
  console.log(`[team] Видалено схему ${id}`);
}

export async function ensureTypicalSchemes() {
  let created = 0;
  for (const row of TYPICAL_SCHEMES) {
    const existing = await prisma.teamPayScheme.findFirst({
      where: { title: row.title, kind: row.kind },
    });
    if (existing) continue;
    await prisma.teamPayScheme.create({
      data: {
        title: row.title,
        kind: row.kind,
        params: row.params,
        isActive: true,
      },
    });
    created += 1;
  }
  console.log(`[team] Типові схеми: створено ${created}`);
  return { created, schemes: await listTeamSchemes() };
}

export async function importTeamMembersFromAltegio() {
  const staff = await listJournalStaffFromAltegio();
  const masters = await prisma.directMaster.findMany({
    where: { altegioStaffId: { not: null } },
    select: { id: true, altegioStaffId: true, name: true },
  });
  const masterByAltegio = new Map(
    masters.filter((m) => m.altegioStaffId != null).map((m) => [m.altegioStaffId as number, m]),
  );

  let created = 0;
  let updated = 0;
  let order = 0;
  for (const s of staff) {
    order += 1;
    const salonRole = salonRoleFromAltegio(s.positionKind);
    const linkedMaster = masterByAltegio.get(s.altegioStaffId);
    const existing = await prisma.teamMember.findUnique({ where: { altegioStaffId: s.altegioStaffId } });
    if (existing) {
      await prisma.teamMember.update({
        where: { id: existing.id },
        data: {
          name: s.name,
          salonRole,
          isActive: true,
          order,
          directMasterId: existing.directMasterId || linkedMaster?.id || null,
        },
      });
      updated += 1;
    } else {
      // Не чіпаємо чужий directMasterId, якщо вже зайнятий іншою карткою
      let directMasterId: string | null = linkedMaster?.id || null;
      if (directMasterId) {
        const taken = await prisma.teamMember.findUnique({ where: { directMasterId } });
        if (taken) directMasterId = null;
      }
      await prisma.teamMember.create({
        data: {
          name: s.name,
          salonRole,
          altegioStaffId: s.altegioStaffId,
          directMasterId,
          isActive: true,
          order,
        },
      });
      created += 1;
    }
  }
  console.log(
    `[team] Імпорт Altegio: staff=${staff.length} created=${created} updated=${updated}`,
  );
  return { count: staff.length, created, updated, members: await listTeamMembers() };
}
