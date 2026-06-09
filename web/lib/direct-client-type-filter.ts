/**
 * Фільтр типу клієнта (leads / clients / consulted / good / stars) для Direct.
 * AND-логіка: клієнт має відповідати всім вибраним міткам (узгоджено з heavy path і DirectClientTable).
 */
import { Prisma } from '@prisma/client';

export type ClientTypeFilter = 'leads' | 'clients' | 'consulted' | 'good' | 'stars';

const CLIENT_TYPE_FILTERS = new Set<ClientTypeFilter>([
  'leads',
  'clients',
  'consulted',
  'good',
  'stars',
]);

export function parseClientTypeParam(raw: string | null | undefined): ClientTypeFilter[] {
  return (raw || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is ClientTypeFilter => CLIENT_TYPE_FILTERS.has(x as ClientTypeFilter));
}

export function buildClientTypePrismaConditions(
  types: ClientTypeFilter[]
): Prisma.DirectClientWhereInput[] {
  const conditions: Prisma.DirectClientWhereInput[] = [];
  for (const filterType of types) {
    if (filterType === 'leads') {
      conditions.push({ altegioClientId: null });
    } else if (filterType === 'clients') {
      conditions.push({ altegioClientId: { not: null } });
    } else if (filterType === 'consulted') {
      conditions.push({
        AND: [{ altegioClientId: { not: null } }, { OR: [{ spent: null }, { spent: 0 }] }],
      });
    } else if (filterType === 'good') {
      conditions.push({ spent: { gt: 0, lt: 100000 } });
    } else if (filterType === 'stars') {
      conditions.push({ spent: { gte: 100000 } });
    }
  }
  return conditions;
}

export function buildClientTypeSqlFragments(types: ClientTypeFilter[]): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  for (const filterType of types) {
    if (filterType === 'leads') {
      parts.push(Prisma.sql`"altegioClientId" IS NULL`);
    } else if (filterType === 'clients') {
      parts.push(Prisma.sql`"altegioClientId" IS NOT NULL`);
    } else if (filterType === 'consulted') {
      parts.push(
        Prisma.sql`("altegioClientId" IS NOT NULL AND COALESCE("spent", 0) = 0)`
      );
    } else if (filterType === 'good') {
      parts.push(Prisma.sql`("spent" > 0 AND "spent" < 100000)`);
    } else if (filterType === 'stars') {
      parts.push(Prisma.sql`"spent" >= 100000`);
    }
  }
  return parts;
}
