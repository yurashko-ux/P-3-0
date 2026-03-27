// Єдине джерело кешу *KyivDay + globalThis (Next може дублювати chunk — один кеш на ізолят).
// Наявність колонок: information_schema (без SELECT неіснуючих полів — інакше шум у логах Prisma).
import { Prisma, type PrismaClient } from '@prisma/client';

const KYIV_DAY_SCALAR_FIELDS = new Set(['paidServiceKyivDay', 'consultationBookingKyivDay']);

/**
 * Усі скалярні поля DirectClient для Prisma select, окрім *KyivDay.
 * Потрібно, коли міграція ще не застосована на БД (інакше P2022 на SELECT).
 */
export function getDirectClientScalarSelectWithoutKyivDays(): Record<string, true> {
  const out: Record<string, true> = {};
  for (const v of Object.values(Prisma.DirectClientScalarFieldEnum)) {
    if (!KYIV_DAY_SCALAR_FIELDS.has(v)) out[v] = true;
  }
  return out;
}

export function stripKyivDayFieldsFromDirectClientWriteData(data: Record<string, unknown> | undefined | null): void {
  if (!data || typeof data !== 'object') return;
  delete data.paidServiceKyivDay;
  delete data.consultationBookingKyivDay;
}

/** Видаляє *KyivDay з data create/update/upsert/updateMany/createMany перед записом у БД без колонок. */
export function stripKyivDayFieldsFromDirectClientMutation(action: string, args: unknown): void {
  if (!args || typeof args !== 'object') return;
  const a = args as Record<string, unknown>;
  switch (action) {
    case 'create':
      stripKyivDayFieldsFromDirectClientWriteData(a.data as Record<string, unknown>);
      break;
    case 'update':
      stripKyivDayFieldsFromDirectClientWriteData(a.data as Record<string, unknown>);
      break;
    case 'upsert':
      stripKyivDayFieldsFromDirectClientWriteData(a.create as Record<string, unknown>);
      stripKyivDayFieldsFromDirectClientWriteData(a.update as Record<string, unknown>);
      break;
    case 'updateMany':
      stripKyivDayFieldsFromDirectClientWriteData(a.data as Record<string, unknown>);
      break;
    case 'createMany': {
      const rows = a.data as unknown[] | undefined;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row && typeof row === 'object') {
            stripKyivDayFieldsFromDirectClientWriteData(row as Record<string, unknown>);
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

type G = typeof globalThis & { __kyivDayDirectKyivProbeColumnsExist?: boolean };

let cachedKyivColumnsExist: boolean | null = null;

function readGlobalCache(): boolean | undefined {
  return (globalThis as G).__kyivDayDirectKyivProbeColumnsExist;
}

function writeGlobalCache(v: boolean): void {
  (globalThis as G).__kyivDayDirectKyivProbeColumnsExist = v;
}

/** Перевірка наявності обох *KyivDay без SELECT неіснуючих колонок (інакше Prisma логує prisma:error на кожному запиті). */
async function probeKyivColumnsExist(prisma: PrismaClient): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'direct_clients'
        AND column_name IN ('paidServiceKyivDay', 'consultationBookingKyivDay')
    `;
    const n = Number(rows[0]?.n ?? 0);
    return n >= 2;
  } catch (e: unknown) {
    console.warn(
      '[direct-kyiv-db-columns] probeKyivColumns (information_schema): неочікувана помилка — безпечний режим (немає колонок)',
      e
    );
    return false;
  }
}

/** Завжди свіжий SELECT (не читає module/global кеш) — узгоджено з findMany. */
export async function probeDirectKyivDayColumnsLive(prisma: PrismaClient): Promise<boolean> {
  return probeKyivColumnsExist(prisma);
}

/** Примусово вирівняти кеш після live-probe (middleware omit). */
export function syncKyivDayColumnExistCache(exists: boolean): void {
  cachedKyivColumnsExist = exists;
  writeGlobalCache(exists);
}

export function invalidateKyivDayColumnCache(): void {
  cachedKyivColumnsExist = null;
  delete (globalThis as G).__kyivDayDirectKyivProbeColumnsExist;
}

/**
 * Чи є в public.direct_clients обидві колонки *KyivDay (кеш на процес / ізолят).
 */
export async function kyivDayColumnsExistCached(prisma: PrismaClient): Promise<boolean> {
  const g = readGlobalCache();
  if (g === true || g === false) {
    cachedKyivColumnsExist = g;
    return g;
  }
  if (cachedKyivColumnsExist !== null) {
    writeGlobalCache(cachedKyivColumnsExist);
    return cachedKyivColumnsExist;
  }
  cachedKyivColumnsExist = await probeKyivColumnsExist(prisma);
  writeGlobalCache(cachedKyivColumnsExist);
  return cachedKyivColumnsExist;
}
