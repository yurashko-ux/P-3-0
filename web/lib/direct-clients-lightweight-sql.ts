/**
 * Фрагмент WHERE для lightweight-списку Direct (узгоджено з buildLightweightWhere у clients/route).
 */
import { Prisma } from '@prisma/client';

export function buildLightweightWhereSqlFragment(params: {
  statusId: string | null;
  statusIds: string[];
  masterId: string | null;
  source: string | null;
  hasAppointment: string | null;
  searchQuery: string;
}): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (params.statusIds.length > 0) {
    parts.push(Prisma.sql`"statusId" IN (${Prisma.join(params.statusIds)})`);
  } else if (params.statusId) {
    parts.push(Prisma.sql`"statusId" = ${params.statusId}`);
  }
  if (params.masterId) parts.push(Prisma.sql`"masterId" = ${params.masterId}`);
  if (params.source) parts.push(Prisma.sql`"source" = ${params.source}`);
  if (params.hasAppointment === 'true') parts.push(Prisma.sql`"paidServiceDate" IS NOT NULL`);
  const qTrim = (params.searchQuery || '').trim();
  if (qTrim) {
    const q = `%${qTrim}%`;
    const qDigits = qTrim.replace(/\D/g, '');
    if (qDigits.length >= 2) {
      const phonePat = `%${qDigits}%`;
      parts.push(Prisma.sql`(
        "instagramUsername" ILIKE ${q}
        OR "firstName" ILIKE ${q}
        OR "lastName" ILIKE ${q}
        OR regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g') LIKE ${phonePat}
      )`);
    } else {
      parts.push(Prisma.sql`(
        "instagramUsername" ILIKE ${q}
        OR "firstName" ILIKE ${q}
        OR "lastName" ILIKE ${q}
      )`);
    }
  }
  if (parts.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(parts, ' AND ');
}
