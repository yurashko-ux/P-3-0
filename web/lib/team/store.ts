// Команда: люди, посади і схеми нарахування ЗП.

import { prisma } from "@/lib/prisma";
import { listJournalStaffFromAltegio } from "@/lib/journal/staff";
import { normalizeInstagram } from "@/lib/normalize";
import { Prisma } from "@prisma/client";
import {
  TEAM_PAY_KINDS,
  TEAM_POSITION_SEED,
  TEAM_SALON_ROLES,
  TYPICAL_SCHEMES,
  getTodayKyivYmd,
  type TeamPayKind,
  type TeamSalonRole,
} from "@/lib/team/constants";
import { sanitizeSchemeParams } from "@/lib/team/pay-scheme-calc";
import { randomUUID } from "crypto";

export { TEAM_PAY_KINDS, TEAM_SALON_ROLES, TYPICAL_SCHEMES, TEAM_POSITION_SEED, getTodayKyivYmd };
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

function isKyivYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function uniqueSchemeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sameSchemeSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

const schemeBriefSelect = { id: true, title: true, kind: true, isActive: true } as const;

const memberInclude = {
  position: true,
  directMaster: { select: { id: true, name: true, role: true, altegioStaffId: true } },
  appUser: { select: { id: true, name: true, login: true } },
  payAssignments: {
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    take: 5,
    include: {
      schemes: {
        orderBy: { order: "asc" },
        include: { scheme: { select: schemeBriefSelect } },
      },
      ruleVersion: { select: { id: true, effectiveFrom: true, positionId: true } },
    },
  },
} satisfies Prisma.TeamMemberInclude;

/** BigInt telegramChatId → string для JSON. */
function serializeMember<T extends { telegramChatId?: bigint | null }>(m: T) {
  const row = m as T & {
    payAssignments?: Array<{
      schemes?: Array<{ scheme: unknown; order: number }>;
      effectiveFrom: string;
      id: string;
      ruleVersionId?: string | null;
    }>;
  };
  const currentAssignment = row.payAssignments?.[0] ?? null;
  const currentSchemes =
    currentAssignment?.schemes?.map((link) => link.scheme).filter(Boolean) ?? [];
  return {
    ...m,
    telegramChatId: m.telegramChatId != null ? m.telegramChatId.toString() : null,
    currentPayAssignment: currentAssignment
      ? {
          id: currentAssignment.id,
          effectiveFrom: currentAssignment.effectiveFrom,
          ruleVersionId: currentAssignment.ruleVersionId ?? null,
          schemes: currentSchemes,
        }
      : null,
    paySchemeIds: currentSchemes.map((s: any) => s.id as string),
  };
}

export async function ensureSeedPositions() {
  for (const seed of TEAM_POSITION_SEED) {
    const existing = await prisma.teamPosition.findFirst({ where: { code: seed.code } });
    if (existing) continue;
    await prisma.teamPosition.create({
      data: {
        id: `pos_${seed.code}`,
        name: seed.name,
        code: seed.code,
        isActive: true,
        order: seed.order,
      },
    });
    console.log(`[team] Створено посаду «${seed.name}» code=${seed.code}`);
  }
}

export async function listTeamPositions(opts?: { includeInactive?: boolean }) {
  await ensureSeedPositions();
  return prisma.teamPosition.findMany({
    where: opts?.includeInactive ? undefined : { isActive: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      ruleVersions: {
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: {
          schemes: {
            orderBy: { order: "asc" },
            include: { scheme: { select: schemeBriefSelect } },
          },
        },
      },
      _count: { select: { members: true } },
    },
  });
}

export type TeamPositionInput = {
  name: string;
  code?: string | null;
  isActive?: boolean;
  order?: number;
};

export async function createTeamPosition(input: TeamPositionInput) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Вкажіть назву посади");
  const codeRaw = input.code != null ? String(input.code).trim().toLowerCase() : "";
  const code = codeRaw || null;
  if (code) {
    const taken = await prisma.teamPosition.findFirst({ where: { code } });
    if (taken) throw new Error(`Код посади «${code}» уже зайнятий`);
  }
  const created = await prisma.teamPosition.create({
    data: {
      name,
      code,
      isActive: input.isActive !== false,
      order: Number.isFinite(Number(input.order)) ? Number(input.order) : 100,
    },
  });
  console.log(`[team] Створено посаду ${created.id} «${created.name}»`);
  return created;
}

export async function updateTeamPosition(id: string, input: TeamPositionInput) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Вкажіть назву посади");
  const codeRaw = input.code != null ? String(input.code).trim().toLowerCase() : "";
  const code = codeRaw || null;
  if (code) {
    const taken = await prisma.teamPosition.findFirst({
      where: { code, NOT: { id } },
    });
    if (taken) throw new Error(`Код посади «${code}» уже зайнятий`);
  }
  const updated = await prisma.teamPosition.update({
    where: { id },
    data: {
      name,
      code,
      isActive: input.isActive !== false,
      order: Number.isFinite(Number(input.order)) ? Number(input.order) : 100,
    },
  });
  console.log(`[team] Оновлено посаду ${id}`);
  return updated;
}

export async function deleteTeamPosition(id: string) {
  const inUse = await prisma.teamMember.count({ where: { positionId: id } });
  if (inUse > 0) {
    throw new Error(`Посаду призначено ${inUse} людям — спочатку змініть посаду`);
  }
  await prisma.teamPosition.delete({ where: { id } });
  console.log(`[team] Видалено посаду ${id}`);
}

async function getCurrentRuleSchemeIds(positionId: string): Promise<string[]> {
  const version = await prisma.teamPositionPayRuleVersion.findFirst({
    where: { positionId },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    include: { schemes: { orderBy: { order: "asc" } } },
  });
  return version?.schemes.map((s) => s.schemeId) ?? [];
}

/**
 * Нова версія правила посади + синхронізація призначень усім людям з цією посадою.
 * Особистих винятків немає.
 */
export async function setPositionPaySchemes(params: {
  positionId: string;
  schemeIds: string[];
  effectiveFrom?: string | null;
  note?: string | null;
}) {
  const positionId = String(params.positionId || "").trim();
  if (!positionId) throw new Error("Вкажіть посаду");
  const position = await prisma.teamPosition.findUnique({ where: { id: positionId } });
  if (!position) throw new Error("Посаду не знайдено");

  const schemeIds = uniqueSchemeIds(params.schemeIds);
  if (schemeIds.length > 0) {
    const found = await prisma.teamPayScheme.findMany({
      where: { id: { in: schemeIds }, isActive: true },
      select: { id: true },
    });
    if (found.length !== schemeIds.length) {
      throw new Error("Деякі схеми неактивні або не знайдені");
    }
  }

  const effectiveFrom = isKyivYmd(params.effectiveFrom) ? params.effectiveFrom : getTodayKyivYmd();
  const currentIds = await getCurrentRuleSchemeIds(positionId);
  if (sameSchemeSet(currentIds, schemeIds)) {
    console.log(`[team] Правило посади ${positionId}: схеми без змін, версію не створюємо`);
    return {
      unchanged: true as const,
      effectiveFrom,
      schemeIds,
      versionId: null as string | null,
      syncedMembers: 0,
    };
  }

  const versionId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.teamPositionPayRuleVersion.create({
      data: {
        id: versionId,
        positionId,
        effectiveFrom,
        note: params.note ? String(params.note).trim() || null : null,
        schemes: {
          create: schemeIds.map((schemeId, order) => ({
            id: randomUUID(),
            schemeId,
            order,
          })),
        },
      },
    });

    const members = await tx.teamMember.findMany({
      where: { positionId },
      select: { id: true },
    });
    for (const member of members) {
      await tx.teamMemberPayAssignment.create({
        data: {
          id: randomUUID(),
          memberId: member.id,
          positionId,
          ruleVersionId: versionId,
          effectiveFrom,
          schemes: {
            create: schemeIds.map((schemeId, order) => ({
              id: randomUUID(),
              schemeId,
              order,
            })),
          },
        },
      });
    }
    console.log(
      `[team] Правило посади «${position.name}»: version=${versionId} schemes=${schemeIds.length} effectiveFrom=${effectiveFrom} synced=${members.length}`,
    );
  });

  const syncedMembers = await prisma.teamMember.count({ where: { positionId } });
  return {
    unchanged: false as const,
    effectiveFrom,
    schemeIds,
    versionId,
    syncedMembers,
  };
}

export async function listTeamMembers() {
  await ensureSeedPositions();
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
  positionId?: string | null;
  /** @deprecated для імпорту */
  salonRole?: string;
  altegioStaffId?: number | null;
  directMasterId?: string | null;
  appUserId?: string | null;
  /** Набір схем посади (І+І). Зміна оновлює правило посади для всіх. */
  paySchemeIds?: string[] | null;
  effectiveFrom?: string | null;
  phone?: string | null;
  instagramUsername?: string | null;
  telegramUsername?: string | null;
  telegramChatId?: number | string | null;
  isActive?: boolean;
  order?: number;
};

async function resolvePositionId(input: TeamMemberInput): Promise<{ positionId: string | null; salonRole: string }> {
  if (input.positionId) {
    const pos = await prisma.teamPosition.findUnique({ where: { id: String(input.positionId) } });
    if (!pos) throw new Error("Посаду не знайдено");
    return { positionId: pos.id, salonRole: pos.code && isSalonRole(pos.code) ? pos.code : "other" };
  }
  if (isSalonRole(input.salonRole)) {
    await ensureSeedPositions();
    const pos = await prisma.teamPosition.findFirst({ where: { code: input.salonRole } });
    return { positionId: pos?.id ?? null, salonRole: input.salonRole };
  }
  await ensureSeedPositions();
  const other = await prisma.teamPosition.findFirst({ where: { code: "other" } });
  return { positionId: other?.id ?? null, salonRole: "other" };
}

function normalizeMemberCore(input: TeamMemberInput) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Вкажіть імʼя");
  const altegioStaffId =
    input.altegioStaffId != null && Number(input.altegioStaffId) > 0 ? Number(input.altegioStaffId) : null;
  const directMasterId = input.directMasterId ? String(input.directMasterId) : null;
  const appUserId = input.appUserId ? String(input.appUserId) : null;
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
    altegioStaffId,
    directMasterId,
    appUserId,
    phone: input.phone ? String(input.phone).trim() || null : null,
    instagramUsername: normalizeInstagram(input.instagramUsername),
    telegramUsername: input.telegramUsername ? String(input.telegramUsername).replace(/^@/, "").trim() || null : null,
    telegramChatId,
    isActive: input.isActive !== false,
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
  };
}

export async function createTeamMember(input: TeamMemberInput) {
  const core = normalizeMemberCore(input);
  const { positionId, salonRole } = await resolvePositionId(input);
  const created = await prisma.teamMember.create({
    data: { ...core, positionId, salonRole },
    include: memberInclude,
  });

  if (positionId && Array.isArray(input.paySchemeIds)) {
    await setPositionPaySchemes({
      positionId,
      schemeIds: input.paySchemeIds,
      effectiveFrom: input.effectiveFrom,
      note: `З форми людини «${created.name}»`,
    });
  }

  const refreshed = await prisma.teamMember.findUnique({
    where: { id: created.id },
    include: memberInclude,
  });
  console.log(`[team] Створено людину ${created.id} «${created.name}» position=${positionId}`);
  return serializeMember(refreshed!);
}

export async function updateTeamMember(id: string, input: TeamMemberInput) {
  const core = normalizeMemberCore(input);
  const { positionId, salonRole } = await resolvePositionId(input);
  const updated = await prisma.teamMember.update({
    where: { id },
    data: { ...core, positionId, salonRole },
    include: memberInclude,
  });

  if (positionId && Array.isArray(input.paySchemeIds)) {
    await setPositionPaySchemes({
      positionId,
      schemeIds: input.paySchemeIds,
      effectiveFrom: input.effectiveFrom,
      note: `З форми людини «${updated.name}»`,
    });
  }

  const refreshed = await prisma.teamMember.findUnique({
    where: { id },
    include: memberInclude,
  });
  console.log(`[team] Оновлено людину ${id}`);
  return serializeMember(refreshed!);
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
  const params = sanitizeSchemeParams(input.kind, (input.params || {}) as Record<string, unknown>);
  const created = await prisma.teamPayScheme.create({
    data: {
      title,
      kind: input.kind,
      params: params as Prisma.InputJsonValue,
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
  const params = sanitizeSchemeParams(input.kind, (input.params || {}) as Record<string, unknown>);
  console.log(`[team] Оновлення схеми ${id} kind=${input.kind}`);
  return prisma.teamPayScheme.update({
    where: { id },
    data: {
      title,
      kind: input.kind,
      params: params as Prisma.InputJsonValue,
      isActive: input.isActive !== false,
    },
  });
}

export async function deleteTeamScheme(id: string) {
  const [inRules, inAssignments] = await Promise.all([
    prisma.teamPositionPayRuleScheme.count({ where: { schemeId: id } }),
    prisma.teamMemberPayAssignmentScheme.count({ where: { schemeId: id } }),
  ]);
  if (inRules > 0 || inAssignments > 0) {
    throw new Error(
      `Схему використано в правилах посад (${inRules}) або історії призначень (${inAssignments}) — спочатку зніміть`,
    );
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
  await ensureSeedPositions();
  const staff = await listJournalStaffFromAltegio();
  const masters = await prisma.directMaster.findMany({
    where: { altegioStaffId: { not: null } },
    select: { id: true, altegioStaffId: true, name: true },
  });
  const masterByAltegio = new Map(
    masters.filter((m) => m.altegioStaffId != null).map((m) => [m.altegioStaffId as number, m]),
  );
  const positions = await prisma.teamPosition.findMany({ where: { code: { not: null } } });
  const positionByCode = new Map(positions.filter((p) => p.code).map((p) => [p.code as string, p.id]));

  let created = 0;
  let updated = 0;
  let order = 0;
  for (const s of staff) {
    order += 1;
    const salonRole = salonRoleFromAltegio(s.positionKind);
    const positionId = positionByCode.get(salonRole) ?? positionByCode.get("other") ?? null;
    const linkedMaster = masterByAltegio.get(s.altegioStaffId);
    const existing = await prisma.teamMember.findUnique({ where: { altegioStaffId: s.altegioStaffId } });
    if (existing) {
      await prisma.teamMember.update({
        where: { id: existing.id },
        data: {
          name: s.name,
          salonRole,
          positionId,
          isActive: true,
          order,
          directMasterId: existing.directMasterId || linkedMaster?.id || null,
        },
      });
      updated += 1;
    } else {
      let directMasterId: string | null = linkedMaster?.id || null;
      if (directMasterId) {
        const taken = await prisma.teamMember.findUnique({ where: { directMasterId } });
        if (taken) directMasterId = null;
      }
      await prisma.teamMember.create({
        data: {
          name: s.name,
          salonRole,
          positionId,
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
