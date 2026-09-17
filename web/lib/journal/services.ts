// Довідник послуг журналу: імпорт з Altegio, kind, тривалість.

import { prisma } from "@/lib/prisma";
import { altegioFetch } from "@/lib/altegio/client";
import { classifyServiceKind, type SalonServiceKind } from "./kind";
import { resolveJournalCompanyId } from "./company-id";

function unwrapList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data;
  const inner = obj.data;
  if (inner && typeof inner === "object" && Array.isArray((inner as any).services)) {
    return (inner as any).services;
  }
  if (Array.isArray((obj as any).services)) return (obj as any).services;
  return [];
}

export async function listAltegioServices(): Promise<Array<{ id: number; title: string; durationSec: number }>> {
  const companyId = resolveJournalCompanyId();
  const paths = [`/company/${companyId}/services`, `/services/${companyId}`];
  for (const path of paths) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const list = unwrapList(raw);
      const rows: Array<{ id: number; title: string; durationSec: number }> = [];
      for (const item of list) {
        const id = Number(item?.id ?? item?.service_id ?? 0);
        const title = String(item?.title ?? item?.name ?? "").trim();
        const duration = Number(item?.duration ?? item?.seance_length ?? item?.length ?? 0);
        if (id > 0 && title) {
          rows.push({
            id,
            title,
            durationSec: duration > 0 ? Math.round(duration) : 3600,
          });
        }
      }
      if (rows.length > 0) {
        console.log(`[journal/services] Послуги Altegio: ${rows.length} (${path})`);
        return rows;
      }
    } catch (err) {
      console.warn(`[journal/services] Не вдалося прочитати ${path}:`, err instanceof Error ? err.message : err);
    }
  }
  return [];
}

export async function importSalonServicesFromAltegio(): Promise<{ imported: number; updated: number }> {
  const remote = await listAltegioServices();
  if (remote.length === 0) {
    throw new Error("Altegio не повернув послуг. Перевірте ALTEGIO_COMPANY_ID і права журналу.");
  }
  let imported = 0;
  let updated = 0;
  for (const row of remote) {
    const kind = classifyServiceKind(row.title);
    const existing = await prisma.salonService.findUnique({ where: { altegioServiceId: row.id } });
    if (!existing) {
      await prisma.salonService.create({
        data: {
          title: row.title,
          altegioServiceId: row.id,
          kind,
          durationSec: row.durationSec,
          isActive: true,
        },
      });
      imported += 1;
      continue;
    }
    await prisma.salonService.update({
      where: { id: existing.id },
      data: {
        title: row.title,
        durationSec: row.durationSec,
        isActive: true,
        // kind не затираємо, якщо вже виставили вручну і він відрізняється від regex
      },
    });
    updated += 1;
  }
  console.log(`[journal/services] Імпорт: нових=${imported}, оновлено=${updated}`);
  return { imported, updated };
}

export async function listSalonServices(includeInactive = false) {
  return prisma.salonService.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ kind: "asc" }, { title: "asc" }],
  });
}

export async function updateSalonServiceKind(id: string, kind: SalonServiceKind) {
  if (kind !== "consultation" && kind !== "hair" && kind !== "other") {
    throw new Error("Тип послуги: consultation, hair або other");
  }
  return prisma.salonService.update({ where: { id }, data: { kind } });
}

export async function ensureSalonServiceFromLine(params: {
  altegioServiceId: number | null;
  title: string;
}) {
  const title = String(params.title || "").trim() || "Послуга";
  if (params.altegioServiceId && params.altegioServiceId > 0) {
    const existing = await prisma.salonService.findUnique({
      where: { altegioServiceId: params.altegioServiceId },
    });
    if (existing) return existing;
    return prisma.salonService.create({
      data: {
        title,
        altegioServiceId: params.altegioServiceId,
        kind: classifyServiceKind(title),
        durationSec: 3600,
        isActive: true,
      },
    });
  }
  return null;
}
