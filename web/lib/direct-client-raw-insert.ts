/**
 * Обхід P2022: prisma.directClient.create() може звертатися до полів зі schema.prisma,
 * яких ще немає в БД (навіть якщо їх немає в JS-об’єкті data). INSERT лише по колонках з information_schema.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

const KYIV_OMIT = new Set(['paidServiceKyivDay', 'consultationBookingKyivDay']);

let cachedDirectClientsColumns: Set<string> | null = null;

export function invalidateDirectClientsTableColumnCache(): void {
  cachedDirectClientsColumns = null;
}

export async function getDirectClientsTableColumnNames(prisma: PrismaClient): Promise<Set<string>> {
  if (cachedDirectClientsColumns) return cachedDirectClientsColumns;
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name::text AS column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'direct_clients'
  `;
  cachedDirectClientsColumns = new Set(rows.map((r) => r.column_name));
  return cachedDirectClientsColumns;
}

function valueToSql(value: unknown): Prisma.Sql {
  if (value === null) return Prisma.sql`${null}`;
  if (value instanceof Date) return Prisma.sql`${value}`;
  if (typeof value === 'bigint') return Prisma.sql`${value}`;
  if (typeof value === 'number') return Prisma.sql`${value}`;
  if (typeof value === 'boolean') return Prisma.sql`${value}`;
  if (typeof value === 'string') return Prisma.sql`${value}`;
  if (typeof value === 'object') {
    return Prisma.sql`${value as Prisma.InputJsonValue}`;
  }
  return Prisma.sql`${null}`;
}

export async function insertDirectClientRowMatchingDbColumns(
  prisma: PrismaClient,
  data: Record<string, unknown>
): Promise<void> {
  const cols = await getDirectClientsTableColumnNames(prisma);
  const entries = Object.entries(data).filter(
    ([k, v]) => v !== undefined && cols.has(k) && !KYIV_OMIT.has(k)
  );
  if (entries.length === 0) {
    throw new Error('[direct-client-raw-insert] немає колонок для INSERT після фільтрації з БД');
  }
  const columnNames = entries.map(([k]) => k);
  const colSql = Prisma.join(columnNames.map((c) => Prisma.raw(`"${c}"`)));
  const valSql = Prisma.join(entries.map(([, v]) => valueToSql(v)));
  await prisma.$executeRaw`
    INSERT INTO "direct_clients" (${colSql})
    VALUES (${valSql})
  `;
}
