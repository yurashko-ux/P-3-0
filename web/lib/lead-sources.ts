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
  sortOrder: number;
};

const DEFAULTS: Array<Omit<LeadSourceRow, "id">> = [
  { code: "agency_2", name: "Агенція 1", mark: "💙", kind: "ads", enabled: true, sortOrder: 10 },
  { code: "agency_1", name: "Агенція 2", mark: "*", kind: "ads", enabled: true, sortOrder: 20 },
  { code: "organic", name: "Органіка", mark: null, kind: "organic", enabled: true, sortOrder: 30 },
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
  sortOrder: number;
}): LeadSourceRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    mark: row.mark,
    kind: asKind(row.kind),
    enabled: row.enabled,
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

export async function assignLeadSourceFromFirstIncoming(input: {
  clientId: string;
  leadAgency: string | null;
  text: string;
}): Promise<string | null> {
  if (input.leadAgency) return input.leadAgency;
  const prior = await prisma.directMessage.count({
    where: { clientId: input.clientId, direction: "incoming" },
  });
  if (prior > 0) return null;
  const code = await matchLeadSourceCode(input.text);
  await prisma.directClient.update({
    where: { id: input.clientId },
    data: { leadAgency: code },
  });
  console.log("[leads] Джерело за першим вхідним", { clientId: input.clientId, code });
  return code;
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
};

export async function leadSourceStats(monthKey: string): Promise<LeadSourceStat[]> {
  const sources = await ensureLeadSources();
  const clients = await prisma.directClient.findMany({
    where: { leadAgency: { not: null }, includeInNewLeadsKpi: true },
    select: {
      leadAgency: true,
      firstContactDate: true,
      consultationBookingDate: true,
      paidServiceDate: true,
      instagramUsername: true,
    },
  });
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
    };
  });
}
