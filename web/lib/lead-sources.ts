// Джерело ліда:
// - спочатку referral.ad_id, якщо кабінет уже привʼязаний до цього ad_id;
// - якщо ad_id немає або кабінет ще не привʼязаний — емодзі в тексті першого вхідного
//   (кілька емодзі можуть вести в одне джерело; біля хмарки лишається один LeadSource.mark);
// - без ad_id і без привʼязаного емодзі — leadAgency = null («не визначено»);
// - органіку ставить маркетолог вручну;
// - Сайт — окремий вхід, з Instagram не ставиться.
// Старих лідів привʼязка емодзі не переписує.

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

/** Усі емодзі в тексті, у порядку появи, без повторів. Звичайні літери і «*» сюди не входять. */
export function extractMessageEmojis(text: string): string[] {
  const re =
    /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*[\u{1F3FB}-\u{1F3FF}]?/gu;
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(re)) {
    const emoji = match[0];
    if (!emoji || seen.has(emoji)) continue;
    seen.add(emoji);
    found.push(emoji);
  }
  return found;
}

/** Рівно один емодзі, без зайвого тексту. */
export function asSingleEmoji(value: string): string | null {
  const trimmed = value.trim();
  const list = extractMessageEmojis(trimmed);
  if (list.length !== 1 || list[0] !== trimmed) return null;
  return list[0];
}

/**
 * Перший привʼязаний емодзі в тексті. Далі — старий знак джерела, якщо це не емодзі (наприклад *).
 * Органіку не підставляємо.
 */
export async function matchLeadSourceCode(text: string): Promise<string | null> {
  const sources = await ensureLeadSources();
  const ads = sources.filter((source) => source.enabled && source.kind === "ads");
  const codeByMark = new Map(ads.filter((source) => source.mark).map((source) => [source.mark as string, source.code]));
  const bound = await prisma.leadSourceEmoji.findMany({
    where: { sourceCode: { not: null } },
    select: { emoji: true, sourceCode: true },
  });
  const codeByEmoji = new Map(
    bound.filter((row) => row.sourceCode && ads.some((source) => source.code === row.sourceCode)).map((row) => [row.emoji, row.sourceCode as string]),
  );
  for (const emoji of extractMessageEmojis(text)) {
    const code = codeByEmoji.get(emoji) || codeByMark.get(emoji);
    if (code) return code;
  }
  const symbols = ads
    .filter((source) => source.mark && extractMessageEmojis(source.mark).length === 0)
    .sort((a, b) => (b.mark || "").length - (a.mark || "").length);
  for (const source of symbols) {
    if (text.includes(source.mark || "")) return source.code;
  }
  return null;
}

/** Запамʼятати емодзі першого повідомлення, навіть якщо джерело ще не призначене. Привʼязку не затирає. */
export async function recordLeadMessageEmojis(text: string, username?: string | null): Promise<void> {
  const emojis = extractMessageEmojis(text || "");
  const cleanUsername = username?.trim() || null;
  for (const emoji of emojis) {
    try {
      await prisma.leadSourceEmoji.upsert({
        where: { emoji },
        create: { emoji, lastUsername: cleanUsername },
        update: cleanUsername ? { lastUsername: cleanUsername } : {},
      });
    } catch (error) {
      console.warn("[leads] Не вдалося зберегти емодзі", {
        emoji,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
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
  username?: string | null;
}): Promise<string | null> {
  if (input.leadAgency) return input.leadAgency;
  const prior = await prisma.directMessage.count({
    where: { clientId: input.clientId, direction: "incoming" },
  });
  if (prior > 0) return null;

  await recordLeadMessageEmojis(input.text, input.username);

  // ad_id — основний шлях. Емодзі в тексті його доповнює: коли оголошення немає
  // або кабінет для цього ad_id ще не привʼязаний. Органіку з тексту не ставимо.
  let code: string | null = null;
  let by: "ad_id" | "мітка" | null = null;
  if (input.adId) {
    code = await resolveLeadSourceByAdId(input.adId);
    if (code) by = "ad_id";
  }
  if (!code) {
    const fromMark = await matchLeadSourceCode(input.text || "");
    if (fromMark) {
      code = fromMark;
      by = "мітка";
    }
  }

  if (!input.adId && !code) {
    console.log("[leads] Перше вхідне без ad_id і без мітки — leadAgency не визначено", {
      clientId: input.clientId,
    });
    return null;
  }

  await prisma.directClient.update({
    where: { id: input.clientId },
    data: {
      ...(input.adId ? { leadAdId: input.adId } : {}),
      ...(code ? { leadAgency: code } : {}),
    },
  });
  console.log("[leads] Джерело за першим вхідним", {
    clientId: input.clientId,
    code,
    adId: input.adId || null,
    by,
  });
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

export type LeadEmojiRow = {
  id: string;
  emoji: string;
  sourceCode: string | null;
  sourceName: string | null;
  firstSeenAt: string;
  lastUsername: string | null;
};

export async function listLeadSourceEmojis(): Promise<LeadEmojiRow[]> {
  const [rows, sources] = await Promise.all([
    prisma.leadSourceEmoji.findMany({ orderBy: { firstSeenAt: "desc" } }),
    prisma.leadSource.findMany({ select: { code: true, name: true } }),
  ]);
  const nameByCode = new Map(sources.map((source) => [source.code, source.name]));
  return rows.map((row) => ({
    id: row.id,
    emoji: row.emoji,
    sourceCode: row.sourceCode,
    sourceName: row.sourceCode ? nameByCode.get(row.sourceCode) || row.sourceCode : null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastUsername: row.lastUsername,
  }));
}

/** Привʼязати або відвʼязати один емодзі. Уже отриманих лідів не чіпає. */
export async function setLeadSourceEmoji(emoji: string, sourceCode: string | null): Promise<void> {
  const clean = asSingleEmoji(emoji);
  if (!clean) throw new Error("Потрібен один емодзі");
  if (sourceCode) {
    const source = await prisma.leadSource.findUnique({ where: { code: sourceCode } });
    if (!source) throw new Error("Невідоме джерело");
    if (source.kind !== "ads") throw new Error("Емодзі привʼязуємо лише до рекламного джерела");
    const takenMark = await prisma.leadSource.findFirst({
      where: { mark: clean, code: { not: sourceCode } },
      select: { name: true },
    });
    if (takenMark) throw new Error(`Цей емодзі вже знак біля хмарки джерела «${takenMark.name}»`);
  } else {
    const existing = await prisma.leadSourceEmoji.findUnique({ where: { emoji: clean }, select: { id: true } });
    if (!existing) throw new Error("Такого емодзі ще не бачили");
  }
  await prisma.leadSourceEmoji.upsert({
    where: { emoji: clean },
    create: { emoji: clean, sourceCode },
    update: { sourceCode },
  });
  console.log("[leads] емодзі → джерело", { emoji: clean, sourceCode });
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
  /** Емодзі першого повідомлення, привʼязані до цього джерела. Біля хмарки їх не малюємо. */
  triggerEmojis: string[];
};

export async function leadSourceStats(monthKey: string): Promise<LeadSourceStat[]> {
  const sources = await ensureLeadSources();
  const [clients, totalCounts, emojiRows] = await Promise.all([
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
    prisma.leadSourceEmoji.findMany({
      where: { sourceCode: { not: null } },
      select: { emoji: true, sourceCode: true },
      orderBy: { firstSeenAt: "asc" },
    }),
  ]);
  const totalByCode = new Map(totalCounts.map((c) => [c.leadAgency as string, c._count._all]));
  const emojisByCode = new Map<string, string[]>();
  for (const row of emojiRows) {
    if (!row.sourceCode) continue;
    const list = emojisByCode.get(row.sourceCode) || [];
    list.push(row.emoji);
    emojisByCode.set(row.sourceCode, list);
  }
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
      triggerEmojis: emojisByCode.get(source.code) || [],
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
