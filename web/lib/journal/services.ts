// Довідник канонічних послуг Kresco + мапінг Altegio (many-to-one).

import { prisma } from "@/lib/prisma";
import { altegioFetch } from "@/lib/altegio/client";
import { randomUUID } from "crypto";
import { classifyServiceKind, type SalonServiceKind } from "./kind";
import { resolveJournalCompanyId } from "./company-id";

export type SalonServiceSource = "mapped" | "kresco";

/** Узгоджені канонічні групи (seed також у міграції). */
export const CANONICAL_SERVICE_SEED: Array<{
  id: string;
  title: string;
  kind: SalonServiceKind;
  durationSec: number;
  links: Array<{ altegioServiceId: number; altegioTitle: string; isDefault: boolean }>;
}> = [
  {
    id: "c0a10001-0001-4000-8000-000000000001",
    title: "Консультація",
    kind: "consultation",
    durationSec: 1800,
    links: [{ altegioServiceId: 11964320, altegioTitle: "Консультація", isDefault: true }],
  },
  {
    id: "c0a10001-0001-4000-8000-000000000002",
    title: "Онлайн-консультація",
    kind: "consultation",
    durationSec: 3600,
    links: [{ altegioServiceId: 13212080, altegioTitle: "Онлайн-консультація", isDefault: true }],
  },
  {
    id: "c0a10001-0001-4000-8000-000000000003",
    title: "Зняття чужого нарощування",
    kind: "hair",
    durationSec: 9000,
    links: [
      { altegioServiceId: 11940573, altegioTitle: "Зняття чужого нарощування", isDefault: true },
      { altegioServiceId: 11940731, altegioTitle: "Зняття чужого нарощування в 4 руки", isDefault: false },
    ],
  },
  {
    id: "c0a10001-0001-4000-8000-000000000004",
    title: "Капсульне (до 130 г)",
    kind: "hair",
    durationSec: 18000,
    links: [
      { altegioServiceId: 11928107, altegioTitle: "Капсульне нарощування 1 майстер (до 130грам)", isDefault: true },
      { altegioServiceId: 11994206, altegioTitle: "Нарощування волосся 2 майстри (до 130 грам)", isDefault: false },
    ],
  },
  {
    id: "c0a10001-0001-4000-8000-000000000005",
    title: "Капсульне (від 130 г)",
    kind: "hair",
    durationSec: 18000,
    links: [
      { altegioServiceId: 11940080, altegioTitle: "Капсульне нарощування 1 майстер (від 130)", isDefault: true },
      { altegioServiceId: 11973822, altegioTitle: "Капсульне нарощування 2 майстри (від 130грам)", isDefault: false },
      { altegioServiceId: 11940097, altegioTitle: "Капсульне нарощування в 4 руки (Асистент)", isDefault: false },
    ],
  },
  {
    id: "c0a10001-0001-4000-8000-000000000006",
    title: "Капсульне — скронева зона",
    kind: "hair",
    durationSec: 10800,
    links: [
      {
        altegioServiceId: 11940099,
        altegioTitle: "Капсульне нарощування волосся - скронева зона",
        isDefault: true,
      },
    ],
  },
  {
    id: "c0a10001-0001-4000-8000-000000000007",
    title: "Капсульне — загущення",
    kind: "hair",
    durationSec: 10800,
    links: [
      {
        altegioServiceId: 11940102,
        altegioTitle: "Капсульне нарощування волосся загущення",
        isDefault: true,
      },
    ],
  },
  {
    id: "c0a10001-0001-4000-8000-000000000008",
    title: "Нарощування на стрічки",
    kind: "hair",
    durationSec: 3600,
    links: [{ altegioServiceId: 11967869, altegioTitle: "Нарощування на стрічки", isDefault: true }],
  },
  {
    id: "c0a10001-0001-4000-8000-000000000009",
    title: "Стрічкове V_BIOTAPE",
    kind: "hair",
    durationSec: 12600,
    links: [{ altegioServiceId: 11974881, altegioTitle: "Стрічкове нарощування V_BIOTAPE", isDefault: true }],
  },
];

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

export type AltegioServiceRow = {
  id: number;
  title: string;
  durationSec: number;
  /** Ціна «від» у каталозі Altegio (0 — не вказана). */
  priceMin: number;
  /** Ціна «до»; якщо більша за priceMin — в Altegio діапазон цін. */
  priceMax: number;
  /** false — послугу в Altegio вимкнено або видалено. */
  active: boolean;
};

/** Число з поля Altegio: приймає число або рядок («1 500», «1500.00»). */
function altegioNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Ціни послуги: поля каталогу, а якщо їх немає — мінімум і максимум із цін майстрів. */
function altegioServicePrices(item: any): { priceMin: number; priceMax: number } {
  let priceMin = Math.max(0, altegioNumber(item?.price_min ?? item?.priceMin ?? item?.cost ?? item?.price));
  let priceMax = Math.max(0, altegioNumber(item?.price_max ?? item?.priceMax ?? item?.cost ?? item?.price));
  if (priceMin === 0 && priceMax === 0 && Array.isArray(item?.staff)) {
    const staffPrices = (item.staff as any[])
      .flatMap((s) => [altegioNumber(s?.price_min ?? s?.price), altegioNumber(s?.price_max ?? s?.price)])
      .filter((p) => p > 0);
    if (staffPrices.length > 0) {
      priceMin = Math.min(...staffPrices);
      priceMax = Math.max(...staffPrices);
    }
  }
  if (priceMax < priceMin) priceMax = priceMin;
  return { priceMin, priceMax };
}

/** Чи послуга жива в Altegio: active / is_active = 0 або deleted = 1 означає вимкнену. */
function altegioServiceActive(item: any): boolean {
  const off = (v: unknown) => v === 0 || v === false || v === "0";
  const on = (v: unknown) => v === 1 || v === true || v === "1";
  if (off(item?.active) || off(item?.is_active)) return false;
  if (on(item?.deleted) || on(item?.is_deleted)) return false;
  return true;
}

export async function listAltegioServices(): Promise<AltegioServiceRow[]> {
  const companyId = resolveJournalCompanyId();
  const paths = [`/company/${companyId}/services`, `/services/${companyId}`];
  for (const path of paths) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const list = unwrapList(raw);
      const rows: AltegioServiceRow[] = [];
      for (const item of list) {
        const id = Number(item?.id ?? item?.service_id ?? 0);
        const title = String(item?.title ?? item?.name ?? "").trim();
        const duration = Number(item?.duration ?? item?.seance_length ?? item?.length ?? 0);
        if (id > 0 && title) {
          rows.push({
            id,
            title,
            durationSec: duration > 0 ? Math.round(duration) : 3600,
            ...altegioServicePrices(item),
            active: altegioServiceActive(item),
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

const serviceListInclude = {
  altegioLinks: {
    orderBy: [{ isDefault: "desc" as const }, { altegioTitle: "asc" as const }],
  },
};

/** Список канонічних послуг Kresco (+ мапінги). */
export async function listSalonServices(includeInactive = false) {
  return prisma.salonService.findMany({
    where: includeInactive ? {} : { isActive: true },
    include: serviceListInclude,
    orderBy: [{ kind: "asc" }, { title: "asc" }],
  });
}

/** Default Altegio id для dual-write (або null для kresco-only). */
export async function resolveDefaultAltegioServiceId(serviceId: string): Promise<number | null> {
  const link = await prisma.salonServiceAltegioLink.findFirst({
    where: { serviceId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return link?.altegioServiceId ?? null;
}

/** Знайти канонічну послугу за id Altegio. */
export async function findSalonServiceByAltegioId(altegioServiceId: number) {
  if (!(altegioServiceId > 0)) return null;
  const link = await prisma.salonServiceAltegioLink.findUnique({
    where: { altegioServiceId },
    include: { service: true },
  });
  return link?.service ?? null;
}

/**
 * Імпорт з Altegio: оновлює назви в мапінгу, НЕ створює нові топ-рівневі дублікати.
 * Незмаплені Altegio-послуги повертає в unmapped для UI.
 */
export async function importSalonServicesFromAltegio(): Promise<{
  linksUpdated: number;
  unmapped: AltegioServiceRow[];
}> {
  await ensureCanonicalServicesSeeded();
  const remote = await listAltegioServices();
  if (remote.length === 0) {
    throw new Error("Altegio не повернув послуг. Перевірте ALTEGIO_COMPANY_ID і права журналу.");
  }

  const existingLinks = await prisma.salonServiceAltegioLink.findMany();
  const byAltegio = new Map(existingLinks.map((l) => [l.altegioServiceId, l]));
  let linksUpdated = 0;
  const unmapped: AltegioServiceRow[] = [];

  for (const row of remote) {
    const link = byAltegio.get(row.id);
    if (link) {
      if (link.altegioTitle !== row.title) {
        await prisma.salonServiceAltegioLink.update({
          where: { id: link.id },
          data: { altegioTitle: row.title },
        });
        linksUpdated += 1;
      }
      continue;
    }
    unmapped.push(row);
  }

  console.log(
    `[journal/services] Імпорт мапінгу: оновлено назв=${linksUpdated}, незмаплено=${unmapped.length}`,
  );
  return { linksUpdated, unmapped };
}

export type CatalogImportItem = {
  altegioServiceId: number;
  altegioTitle: string;
  /** create — нова послуга; update — наявна послуга Kresco з тією ж назвою; activate — уже зв'язана, але вимкнена. */
  action: "create" | "update" | "activate";
  serviceId: string;
  title: string;
  kind: SalonServiceKind;
  durationSec: number;
  /** Ціна, яка стане в Kresco. */
  price: number;
  /** Діапазон цін Altegio «від–до», якщо він є (у Kresco беремо нижню). */
  priceRange: { min: number; max: number } | null;
  /** Ціну в Kresco вже задано вручну — лишаємо її, а не беремо з Altegio. */
  keepsKrescoPrice: boolean;
};

export type CatalogImportResult = {
  dryRun: boolean;
  altegioTotal: number;
  /** Уже зв'язані й активні — не чіпаємо (серед них варіанти нарощування). */
  alreadyLinked: number;
  items: CatalogImportItem[];
  /** Вимкнені або видалені в Altegio — не імпортуємо. */
  skippedInactive: Array<{ id: number; title: string }>;
  /** Активні послуги Kresco, що після імпорту лишаються без пари в Altegio. */
  krescoWithoutAltegio: Array<{ id: string; title: string; kind: string; salePrice: number }>;
};

function normalizeServiceTitle(title: string): string {
  return String(title || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Повний імпорт каталогу Altegio: кожна послуга без мапінгу стає послугою Kresco (назва, ціна, тривалість, зв'язок).
 * Уже зв'язані послуги (канонічне нарощування, консультації) не змінюємо — лише вмикаємо вимкнені.
 * Наявну послугу Kresco з тією ж назвою і без зв'язку оновлюємо, а не дублюємо.
 * dryRun = true — лише перелік змін, без запису в базу.
 */
export async function importFullCatalogFromAltegio(dryRun: boolean): Promise<CatalogImportResult> {
  await ensureCanonicalServicesSeeded();
  const remote = await listAltegioServices();
  if (remote.length === 0) {
    throw new Error("Altegio не повернув послуг. Перевірте ALTEGIO_COMPANY_ID і права журналу.");
  }

  const services = await prisma.salonService.findMany({ include: { altegioLinks: true } });
  const serviceByAltegioId = new Map<number, (typeof services)[number]>();
  for (const service of services) {
    for (const link of service.altegioLinks) serviceByAltegioId.set(link.altegioServiceId, service);
  }
  // Кандидати на збіг за назвою: послуги без жодного зв'язку (старі імпорти спершу, створені в Kresco — потім).
  const freeByTitle = new Map<string, Array<(typeof services)[number]>>();
  for (const service of services) {
    if (service.altegioLinks.length > 0) continue;
    const key = normalizeServiceTitle(service.title);
    const list = freeByTitle.get(key) || [];
    list.push(service);
    freeByTitle.set(key, list);
  }
  for (const list of freeByTitle.values()) {
    list.sort((a, b) => Number(a.source === "kresco") - Number(b.source === "kresco"));
  }

  const items: CatalogImportItem[] = [];
  const skippedInactive: Array<{ id: number; title: string }> = [];
  const writes: any[] = [];
  const pairedServiceIds = new Set<string>();
  const activatedIds = new Set<string>();
  let alreadyLinked = 0;

  for (const row of remote) {
    const priceRange = row.priceMax > row.priceMin && row.priceMin > 0 ? { min: row.priceMin, max: row.priceMax } : null;
    const altegioPrice = row.priceMin > 0 ? row.priceMin : row.priceMax;

    const linked = serviceByAltegioId.get(row.id);
    if (linked) {
      pairedServiceIds.add(linked.id);
      if (linked.isActive || !row.active || activatedIds.has(linked.id)) {
        alreadyLinked += 1;
        continue;
      }
      activatedIds.add(linked.id);
      items.push({
        altegioServiceId: row.id,
        altegioTitle: row.title,
        action: "activate",
        serviceId: linked.id,
        title: linked.title,
        kind: linked.kind as SalonServiceKind,
        durationSec: linked.durationSec,
        price: linked.salePrice,
        priceRange,
        keepsKrescoPrice: true,
      });
      writes.push(prisma.salonService.update({ where: { id: linked.id }, data: { isActive: true } }));
      continue;
    }

    if (!row.active) {
      skippedInactive.push({ id: row.id, title: row.title });
      continue;
    }

    const existing = freeByTitle.get(normalizeServiceTitle(row.title))?.shift();
    if (existing) {
      pairedServiceIds.add(existing.id);
      const keepsKrescoPrice = existing.salePrice > 0;
      const price = keepsKrescoPrice ? existing.salePrice : altegioPrice;
      items.push({
        altegioServiceId: row.id,
        altegioTitle: row.title,
        action: "update",
        serviceId: existing.id,
        title: existing.title,
        kind: existing.kind as SalonServiceKind,
        durationSec: row.durationSec,
        price,
        priceRange,
        keepsKrescoPrice,
      });
      writes.push(
        prisma.salonService.update({
          where: { id: existing.id },
          data: { salePrice: price, durationSec: row.durationSec, isActive: true, source: "mapped" },
        }),
        prisma.salonServiceAltegioLink.create({
          data: { serviceId: existing.id, altegioServiceId: row.id, altegioTitle: row.title, isDefault: true },
        }),
      );
      continue;
    }

    const id = randomUUID();
    const kind = classifyServiceKind(row.title);
    items.push({
      altegioServiceId: row.id,
      altegioTitle: row.title,
      action: "create",
      serviceId: id,
      title: row.title,
      kind,
      durationSec: row.durationSec,
      price: altegioPrice,
      priceRange,
      keepsKrescoPrice: false,
    });
    writes.push(
      prisma.salonService.create({
        data: {
          id,
          title: row.title,
          kind,
          durationSec: row.durationSec,
          salePrice: altegioPrice,
          isActive: true,
          source: "mapped",
        },
      }),
      prisma.salonServiceAltegioLink.create({
        data: { serviceId: id, altegioServiceId: row.id, altegioTitle: row.title, isDefault: true },
      }),
    );
  }

  const krescoWithoutAltegio = services
    .filter((s) => s.isActive && !pairedServiceIds.has(s.id))
    .map((s) => ({ id: s.id, title: s.title, kind: s.kind, salePrice: s.salePrice }));

  if (!dryRun && writes.length > 0) {
    // Одна транзакція: або весь каталог, або нічого.
    await prisma.$transaction(writes);
  }

  const count = (action: CatalogImportItem["action"]) => items.filter((i) => i.action === action).length;
  console.log(
    `[journal/services] Повний імпорт каталогу (${dryRun ? "перегляд" : "запис"}): Altegio=${remote.length}, ` +
      `нових=${count("create")}, оновлено=${count("update")}, увімкнено=${count("activate")}, ` +
      `уже зв'язано=${alreadyLinked}, вимкнених в Altegio=${skippedInactive.length}, ` +
      `Kresco без пари=${krescoWithoutAltegio.length}`,
  );

  return { dryRun, altegioTotal: remote.length, alreadyLinked, items, skippedInactive, krescoWithoutAltegio };
}

/** Ідемпотентний seed канонічних послуг (якщо міграція ще не встигла / порожня БД). */
export async function ensureCanonicalServicesSeeded() {
  for (const seed of CANONICAL_SERVICE_SEED) {
    // На update не перезаписуємо title/kind/durationSec/isActive — їх редагує адмін у UI.
    await prisma.salonService.upsert({
      where: { id: seed.id },
      create: {
        id: seed.id,
        title: seed.title,
        kind: seed.kind,
        durationSec: seed.durationSec,
        isActive: true,
        source: "mapped",
      },
      update: {
        source: "mapped",
      },
    });
    for (const link of seed.links) {
      await prisma.salonServiceAltegioLink.upsert({
        where: { altegioServiceId: link.altegioServiceId },
        create: {
          serviceId: seed.id,
          altegioServiceId: link.altegioServiceId,
          altegioTitle: link.altegioTitle,
          isDefault: link.isDefault,
        },
        update: {
          serviceId: seed.id,
          altegioTitle: link.altegioTitle,
          isDefault: link.isDefault,
        },
      });
    }
  }
}

export async function createKrescoOnlyService(input: {
  title: string;
  kind: SalonServiceKind;
  durationSec?: number;
  salePrice?: number;
}) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Вкажіть назву послуги");
  if (input.kind !== "consultation" && input.kind !== "hair" && input.kind !== "other") {
    throw new Error("Тип послуги: consultation, hair або other");
  }
  const durationSec =
    Number(input.durationSec) > 0 ? Math.round(Number(input.durationSec)) : 3600;
  const salePrice = Math.max(0, Number(input.salePrice) || 0);
  const service = await prisma.salonService.create({
    data: {
      title,
      kind: input.kind,
      durationSec,
      salePrice,
      isActive: true,
      source: "kresco",
    },
    include: serviceListInclude,
  });
  console.log(
    `[journal/services] Створено Kresco-only послугу «${title}» id=${service.id} ціна=${salePrice}`,
  );
  return service;
}

export async function updateSalonService(
  id: string,
  data: {
    title?: string;
    kind?: SalonServiceKind;
    durationSec?: number;
    salePrice?: number;
    isActive?: boolean;
  },
) {
  const existing = await prisma.salonService.findUnique({ where: { id } });
  if (!existing) throw new Error("Послугу не знайдено");
  const patch: {
    title?: string;
    kind?: string;
    durationSec?: number;
    salePrice?: number;
    isActive?: boolean;
  } = {};
  if (data.title != null) {
    const title = String(data.title).trim();
    if (!title) throw new Error("Назва не може бути порожньою");
    patch.title = title;
  }
  if (data.kind != null) {
    if (data.kind !== "consultation" && data.kind !== "hair" && data.kind !== "other") {
      throw new Error("Тип послуги: consultation, hair або other");
    }
    patch.kind = data.kind;
  }
  if (data.durationSec != null && Number(data.durationSec) > 0) {
    patch.durationSec = Math.round(Number(data.durationSec));
  }
  if (data.salePrice != null) {
    patch.salePrice = Math.max(0, Number(data.salePrice) || 0);
  }
  if (typeof data.isActive === "boolean") patch.isActive = data.isActive;
  return prisma.salonService.update({
    where: { id },
    data: patch,
    include: serviceListInclude,
  });
}

export async function updateSalonServiceKind(id: string, kind: SalonServiceKind) {
  return updateSalonService(id, { kind });
}

/**
 * З вебхука/крону Altegio: прив'язати рядок до канонічної послуги за мапінгом.
 * Не створює нових топ-рівневих дублікатів для відомих Altegio id.
 * Для невідомих id — лише лог (рядок запису лишається з altegioServiceId без serviceId).
 */
export async function ensureSalonServiceFromLine(params: {
  altegioServiceId: number | null;
  title: string;
}) {
  const title = String(params.title || "").trim() || "Послуга";
  if (params.altegioServiceId && params.altegioServiceId > 0) {
    const linked = await findSalonServiceByAltegioId(params.altegioServiceId);
    if (linked) {
      // Підтягуємо назву Altegio в мапінг, якщо змінили в кабінеті
      await prisma.salonServiceAltegioLink.updateMany({
        where: { altegioServiceId: params.altegioServiceId },
        data: { altegioTitle: title },
      });
      return linked;
    }
    console.warn(
      `[journal/services] Altegio послуга ${params.altegioServiceId} «${title}» без мапінгу на Kresco — рядок без serviceId`,
    );
    return null;
  }
  // Без Altegio id — шукаємо активну Kresco-only за точною назвою (рідкісний кейс)
  const byTitle = await prisma.salonService.findFirst({
    where: { title, isActive: true, source: "kresco" },
  });
  return byTitle || null;
}
