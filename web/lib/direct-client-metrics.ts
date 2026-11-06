// Метрики клієнта в Kresco: visits / spent / lastVisitAt = база на дату переходу + журнал і чеки.
// Запис журналу рахуємо один раз на день (в 4 руки — кілька рядків на один візит).
// Значення Altegio лишаються контрольними (altegioVisits / altegioSpent) для звірки.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Перерахунок одного клієнта або всіх. Пише лише змінені рядки й не рухає updatedAt. */
export async function recomputeClientMetrics(directClientId?: string): Promise<{ captured: number; updated: number }> {
  const onlyClient = directClientId ? Prisma.sql`AND c."id" = ${directClientId}` : Prisma.empty;

  const captured = await prisma.$executeRaw`
    UPDATE "direct_clients" c
    SET "metricsBaseVisits" = c."visits",
        "metricsBaseSpent" = c."spent",
        "metricsBaseLastVisitAt" = c."lastVisitAt",
        "metricsBaseAt" = NOW()
    WHERE c."metricsBaseAt" IS NULL ${onlyClient}
  `;

  const updated = await prisma.$executeRaw`
    WITH delta AS (
      SELECT a."directClientId" AS id,
             COUNT(DISTINCT a."kyivDay")::int AS visits,
             ROUND(COALESCE(SUM(ck."paidAmount"), 0))::int AS spent,
             MAX(a."datetime") AS last_visit
      FROM "salon_appointments" a
      JOIN "direct_clients" c ON c."id" = a."directClientId"
      LEFT JOIN "salon_checkouts" ck ON ck."appointmentId" = a."id" AND ck."status" <> 'void'
      WHERE a."attendance" = 1
        AND a."status" <> 'deleted'
        AND a."datetime" >= c."metricsBaseAt"
        ${onlyClient}
      GROUP BY a."directClientId"
    ), next AS (
      SELECT c."id",
             CASE WHEN d.id IS NULL THEN c."metricsBaseVisits"
                  ELSE COALESCE(c."metricsBaseVisits", 0) + d.visits END AS visits,
             CASE WHEN d.id IS NULL THEN c."metricsBaseSpent"
                  ELSE COALESCE(c."metricsBaseSpent", 0) + d.spent END AS spent,
             GREATEST(c."lastVisitAt", d.last_visit) AS last_visit
      FROM "direct_clients" c
      LEFT JOIN delta d ON d.id = c."id"
      WHERE c."metricsBaseAt" IS NOT NULL ${onlyClient}
    )
    UPDATE "direct_clients" c
    SET "visits" = n.visits, "spent" = n.spent, "lastVisitAt" = n.last_visit
    FROM next n
    WHERE c."id" = n."id"
      AND (c."visits" IS DISTINCT FROM n.visits
        OR c."spent" IS DISTINCT FROM n.spent
        OR c."lastVisitAt" IS DISTINCT FROM n.last_visit)
  `;

  return { captured, updated };
}

export async function readClientMetrics(directClientId: string) {
  return prisma.directClient.findUnique({
    where: { id: directClientId },
    select: { visits: true, spent: true },
  });
}

/** Нова історія з Altegio (привʼязка клієнта): база зафіксується заново при перерахунку. */
export async function resetClientMetricsBase(directClientId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "direct_clients" SET "metricsBaseAt" = NULL WHERE "id" = ${directClientId}
  `;
}

export async function saveAltegioMetricsShadow(
  directClientId: string,
  visits: number | null,
  spent: number | null,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "direct_clients"
    SET "altegioVisits" = ${visits}, "altegioSpent" = ${spent}
    WHERE "id" = ${directClientId}
      AND ("altegioVisits" IS DISTINCT FROM ${visits}::int OR "altegioSpent" IS DISTINCT FROM ${spent}::int)
  `;
}

export type ClientMetricsDiffRow = {
  id: string;
  instagramUsername: string;
  visits: number | null;
  altegioVisits: number | null;
  spent: number | null;
  altegioSpent: number | null;
};

/** Звірка Kresco ↔ Altegio: скільки клієнтів розходяться і найбільші різниці. */
export async function compareClientMetrics(limit = 50) {
  const totals = await prisma.$queryRaw<Array<{ compared: number; visitsDiff: number; spentDiff: number }>>`
    SELECT COUNT(*)::int AS compared,
           COUNT(*) FILTER (WHERE "visits" IS DISTINCT FROM "altegioVisits")::int AS "visitsDiff",
           COUNT(*) FILTER (WHERE "spent" IS DISTINCT FROM "altegioSpent")::int AS "spentDiff"
    FROM "direct_clients"
    WHERE "altegioVisits" IS NOT NULL OR "altegioSpent" IS NOT NULL
  `;
  const rows = await prisma.$queryRaw<ClientMetricsDiffRow[]>`
    SELECT "id", "instagramUsername", "visits", "altegioVisits", "spent", "altegioSpent"
    FROM "direct_clients"
    WHERE ("altegioVisits" IS NOT NULL OR "altegioSpent" IS NOT NULL)
      AND ("visits" IS DISTINCT FROM "altegioVisits" OR "spent" IS DISTINCT FROM "altegioSpent")
    ORDER BY ABS(COALESCE("spent", 0) - COALESCE("altegioSpent", 0)) DESC
    LIMIT ${limit}
  `;
  return { ...(totals[0] ?? { compared: 0, visitsDiff: 0, spentDiff: 0 }), rows };
}
