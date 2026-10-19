// Джерело ліда: знак із розділу «Ліди» шукаємо лише в першому вхідному повідомленні.
// Органіка — якщо знака немає. Сайт — окремий вхід, з тексту Instagram не ставиться.

import { prisma } from "@/lib/prisma";
import { getDirectManager } from "@/lib/direct-masters/store";
import { toKyivDay } from "@/lib/direct-stats-config";

export type LeadSourceKind = "ads" | "organic" | "website";

export type LeadSourceRow = {
  id: string;
  code: string;
  name: string;
  mark: string | null;
  kind: LeadSourceKind;
  enabled: boolean;
  /** Приховано зі списку вибору (ручне призначення джерела) — статистику й уже проставлених лідів не чіпає. */
  hidden: boolean;
  sortOrder: number;
};

const DEFAULTS: Array<Omit<LeadSourceRow, "id">> = [
  { code: "agency_2", name: "Агенція 1", mark: "💙", kind: "ads", enabled: true, hidden: false, sortOrder: 10 },
  { code: "agency_1", name: "Агенція 2", mark: "*", kind: "ads", enabled: true, hidden: false, sortOrder: 20 },
  { code: "organic", name: "Органіка", mark: null, kind: "organic", enabled: true, hidden: false, sortOrder: 30 },
];

function asKind(value: string): LeadSourceKind {
  if (value === "ads" || value === "organic" || value === "website") return value;
  return "ads";
}

function toRow(row: {
  id: string;
  code: string;
  name: string;
  mark: string | null;
  kind: string;
  enabled: boolean;
  hidden?: boolean;
  sortOrder: number;
}): LeadSourceRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    mark: row.mark,
    kind: asKind(row.kind),
    enabled: row.enabled,
    hidden: row.hidden === true,
    sortOrder: row.sortOrder,
  };
}

export async function ensureLeadSources(): Promise<LeadSourceRow[]> {
  const existing = await prisma.leadSource.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  if (existing.length === 0) {
    for (const item of DEFAULTS) {
      await prisma.leadSource.create({ data: item });
    }
  } else {
    for (const item of DEFAULTS) {
      const found = existing.find((row) => row.code === item.code);
      if (!found) await prisma.leadSource.create({ data: item });
    }
  }
  const rows = await prisma.leadSource.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map(toRow);
}

/** Довший знак перемагає, якщо в тексті збіглось кілька. */
export async function matchLeadSourceCode(text: string): Promise<string> {
  const sources = await ensureLeadSources();
  const marks = sources
    .filter((source) => source.enabled && source.kind === "ads" && source.mark)
    .sort((a, b) => (b.mark || "").length - (a.mark || "").length);
  for (const source of marks) {
    if (text.includes(source.mark || "")) return source.code;
  }
  const organic = sources.find((source) => source.enabled && source.kind === "organic");
  return organic?.code || "organic";
}

/**
 * Запам'ятовує ad_id (і назву оголошення, якщо є) з referral Meta — незалежно від того,
 * чи вже відома агенція. Робить це нерозпізнаним оголошення видимим в адмінці «Джерела»,
 * щоб його можна було прив'язати до кабінету один раз.
 */
export async function recordLeadAdReferral(adId: string, adTitle: string | null, username?: string | null): Promise<void> {
  const clean = adId.trim();
  if (!clean) return;
  const cleanUsername = username?.trim() || null;
  try {
    await prisma.leadSourceAdId.upsert({
      where: { adId: clean },
      create: { adId: clean, adTitle: adTitle || null, lastUsername: cleanUsername },
      update: { ...(adTitle ? { adTitle } : {}), ...(cleanUsername ? { lastUsername: cleanUsername } : {}) },
    });
  } catch (error) {
    console.warn("[leads] Не вдалося зберегти ad_id", { adId: clean, error: error instanceof Error ? error.message : error });
  }
}

/** Чи вже прив'язано цей ad_id до конкретного джерела (агенції). */
async function resolveLeadSourceByAdId(adId: string): Promise<string | null> {
  const row = await prisma.leadSourceAdId.findUnique({ where: { adId }, select: { sourceCode: true } });
  return row?.sourceCode || null;
}

export async function assignLeadSourceFromFirstIncoming(input: {
  clientId: string;
  leadAgency: string | null;
  text: string;
  /** ad_id з referral першого вхідного повідомлення (якщо лід прийшов з реклами). */
  adId?: string | null;
}): Promise<string | null> {
  if (input.leadAgency) return input.leadAgency;
  const prior = await prisma.directMessage.count({
    where: { clientId: input.clientId, direction: "incoming" },
  });
  if (prior > 0) return null;

  // Пріоритет: ad_id конкретного оголошення (найнадійніше, не залежить від тексту) → знак у тексті → органіка.
  // Якщо ad_id є, але ще не призначений кабінету — лишаємо leadAgency = null («не визначено», а не
  // «органіка»), щоб таких лідів було видно в UI й не загубити їх серед справжньої органіки.
  // Коли admin призначить кабінет цьому ad_id, setLeadAdIdSource() донарахує leadAgency автоматично.
  let code: string | null = null;
  if (input.adId) {
    code = await resolveLeadSourceByAdId(input.adId);
  } else {
    code = await matchLeadSourceCode(input.text);
  }

  await prisma.directClient.update({
    where: { id: input.clientId },
    data: { leadAgency: code, ...(input.adId ? { leadAdId: input.adId } : {}) },
  });
  console.log("[leads] Джерело за першим вхідним", { clientId: input.clientId, code, adId: input.adId || null });
  return code;
}

export type LeadAdIdRow = {
  id: string;
  adId: string;
  adTitle: string | null;
  sourceCode: string | null;
  sourceName: string | null;
  firstSeenAt: string;
  leadsCount: number;
  /** Юзернейм останньої людини з цим ad_id — орієнтир, навіть якщо вона вже була контактом раніше. */
  lastUsername: string | null;
};

/** Усі колись побачені ad_id — прив'язані й нерозпізнані, з кількістю лідів кожного. */
export async function listLeadAdIds(): Promise<LeadAdIdRow[]> {
  const [rows, sources, counts] = await Promise.all([
    prisma.leadSourceAdId.findMany({ orderBy: { firstSeenAt: "desc" } }),
    prisma.leadSource.findMany({ select: { code: true, name: true } }),
    prisma.directClient.groupBy({
      by: ["leadAdId"],
      where: { leadAdId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const nameByCode = new Map(sources.map((s) => [s.code, s.name]));
  const countByAdId = new Map(counts.map((c) => [c.leadAdId as string, c._count._all]));
  return rows.map((row) => ({
    id: row.id,
    adId: row.adId,
    adTitle: row.adTitle,
    sourceCode: row.sourceCode,
    sourceName: row.sourceCode ? nameByCode.get(row.sourceCode) || row.sourceCode : null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    leadsCount: countByAdId.get(row.adId) || 0,
    lastUsername: row.lastUsername,
  }));
}

/** Призначає (або скидає, якщо sourceCode = null) агенцію конкретному ad_id і донараховує вже отриманих лідів. */
export async function setLeadAdIdSource(adId: string, sourceCode: string | null): Promise<{ updatedClients: number }> {
  const row = await prisma.leadSourceAdId.findUnique({ where: { adId } });
  if (!row) throw new Error("Таке оголошення ще не бачили");
  if (sourceCode) {
    const source = await prisma.leadSource.findUnique({ where: { code: sourceCode } });
    if (!source) throw new Error("Невідоме джерело");
  }
  await prisma.leadSourceAdId.update({ where: { adId }, data: { sourceCode } });

  let updatedClients = 0;
  if (sourceCode) {
    // Прив'язка по оголошенню надійніша за будь-що інше — донараховуємо вже отриманих лідів з цим ad_id.
    const result = await prisma.directClient.updateMany({
      where: { leadAdId: adId },
      data: { leadAgency: sourceCode },
    });
    updatedClients = result.count;
  }
  console.log("[leads] ad_id → джерело", { adId, sourceCode, updatedClients });
  return { updatedClients };
}

export async function ensureDirectLeadClient(input: {
  username: string;
  receivedAt: Date;
}): Promise<{ id: string; leadAgency: string | null; lastMessageAt: Date | null }> {
  const existing = await prisma.directClient.findFirst({
    where: { instagramUsername: input.username },
    select: { id: true, leadAgency: true, lastMessageAt: true },
  });
  if (existing) return existing;

  const manager = await getDirectManager().catch(() => null);
  const id = `direct_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  try {
    const created = await prisma.directClient.create({
      data: {
        id,
        instagramUsername: input.username,
        source: "instagram",
        state: "message",
        firstContactDate: input.receivedAt,
        statusId: "lead",
        masterId: manager?.id ?? null,
        masterManuallySet: false,
        lastMessageAt: input.receivedAt,
      },
      select: { id: true, leadAgency: true, lastMessageAt: true },
    });
    console.log("[leads] Новий лід з Instagram", { id: created.id, username: input.username });
    return created;
  } catch (error) {
    const again = await prisma.directClient.findFirst({
      where: { instagramUsername: input.username },
      select: { id: true, leadAgency: true, lastMessageAt: true },
    });
    if (again) return again;
    throw error;
  }
}

export type LeadSourceStat = LeadSourceRow & {
  leads: number;
  consultations: number;
  paid: number;
  // Загальна кількість лідів з цим джерелом за весь час (без фільтра місяця/KPI) —
  // використовується, щоб дозволити видалення/редагування лише порожніх джерел.
  totalLeads: number;
};

export async function leadSourceStats(monthKey: string): Promise<LeadSourceStat[]> {
  const sources = await ensureLeadSources();
  const [clients, totalCounts] = await Promise.all([
    prisma.directClient.findMany({
      where: { leadAgency: { not: null }, includeInNewLeadsKpi: true },
      select: {
        leadAgency: true,
        firstContactDate: true,
        consultationBookingDate: true,
        paidServiceDate: true,
        instagramUsername: true,
      },
    }),
    prisma.directClient.groupBy({
      by: ["leadAgency"],
      where: { leadAgency: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const totalByCode = new Map(totalCounts.map((c) => [c.leadAgency as string, c._count._all]));
  return sources.map((source) => {
    const cohort = clients.filter((client) => {
      if (client.leadAgency !== source.code) return false;
      const username = client.instagramUsername || "";
      if (!username || username.startsWith("missing_instagram_") || username.startsWith("no_instagram_")) return false;
      const day = toKyivDay(client.firstContactDate.toISOString());
      return day.startsWith(monthKey);
    });
    return {
      ...source,
      leads: cohort.length,
      consultations: cohort.filter((client) => client.consultationBookingDate).length,
      paid: cohort.filter((client) => client.paidServiceDate).length,
      totalLeads: totalByCode.get(source.code) || 0,
    };
  });
}

/** Чи є хоч один лід, прив'язаний до цього джерела (за весь час) — визначає, чи можна редагувати/видаляти. */
export async function leadSourceHasAnyLead(code: string): Promise<boolean> {
  const count = await prisma.directClient.count({ where: { leadAgency: code } });
  return count > 0;
}

/**
 * Приховує/показує джерело у списку вибору (напр. у ручному призначенні джерела лідам без ad_id).
 * На відміну від редагування/видалення — доступно незалежно від того, є вже ліди чи ні,
 * бо не чіпає статистику й уже проставлених лідів, лише видимість у дропдаунах. Органіку не приховуємо.
 */
export async function setLeadSourceHidden(id: string, hidden: boolean): Promise<void> {
  const current = await prisma.leadSource.findUnique({ where: { id } });
  if (!current) throw new Error("Джерело не знайдено");
  if (current.kind === "organic") throw new Error("Органіку приховати не можна");
  await prisma.leadSource.update({ where: { id }, data: { hidden } });
}

/**
 * Пряме ручне призначення джерела конкретному клієнту — для лідів БЕЗ ad_id (referral від Meta не прийшов).
 * На відміну від setLeadAdIdSource() — не груповий і не прив'язаний до оголошення, лише цей один клієнт.
 * Дозволено перезаписувати вже проставлене leadAgency (напр. авто-органіку) ручним рішенням маркетолога
 * після звірки з Lead Center. Клієнтів з leadAdId сюди не пускаємо — для них є дропдаун «Кабінет (ad_id)».
 */
export async function setClientLeadAgencyManually(clientId: string, sourceCode: string | null): Promise<void> {
  const client = await prisma.directClient.findUnique({ where: { id: clientId }, select: { id: true, leadAdId: true } });
  if (!client) throw new Error("Клієнта не знайдено");
  if (client.leadAdId) throw new Error("У цього ліда вже є ad_id — джерело призначається через «Кабінет (ad_id)»");
  if (sourceCode) {
    const source = await prisma.leadSource.findUnique({ where: { code: sourceCode } });
    if (!source) throw new Error("Невідоме джерело");
  }
  await prisma.directClient.update({ where: { id: clientId }, data: { leadAgency: sourceCode } });
  console.log("[leads] Ручне призначення джерела", { clientId, sourceCode });
}
