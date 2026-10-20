// Переписки: зліва клієнти (консультація або платний візит), справа ліди без живого запису.
// Сортування за останнім повідомленням: нове піднімає картку вгору.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthContext, hasPermission, verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { enrichClientsWithChannelChatMeta } from "@/lib/direct-clients-channel-chat-meta";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const PAGE_SIZE_DEFAULT = 40;
const PAGE_SIZE_MAX = 100;

const TECHNICAL_USERNAME_PREFIXES = [
  "binotel_",
  "missing_instagram_",
  "no_instagram_",
  "altegio_",
  "__no_ig__",
];

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get("host") || "")) return true;
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get("secret");
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

const SOURCE_NAME_FALLBACK: Record<string, string> = {
  agency_1: "Агенція 2",
  agency_2: "Агенція 1",
  organic: "Органіка",
};

function instagramWhere(): Prisma.DirectClientWhereInput {
  return {
    NOT: [
      { state: "binotel-lead" },
      ...TECHNICAL_USERNAME_PREFIXES.map((prefix) => ({
        instagramUsername: { startsWith: prefix },
      })),
    ],
  };
}

/** Жива консультація або вже був платний візит — це клієнт, не лід. */
function clientWhere(): Prisma.DirectClientWhereInput {
  return {
    AND: [
      instagramWhere(),
      {
        OR: [
          {
            AND: [
              { consultationBookingDate: { not: null } },
              { consultationDeletedInAltegio: false },
            ],
          },
          { paidServiceDate: { not: null } },
        ],
      },
    ],
  };
}

/**
 * Сторінка в порядку останнього Instagram-повідомлення.
 * Нове повідомлення піднімає і клієнта, і ліда — те саме, що дата під лічильником Inst.
 */
async function findIdsByLastInstagramMessage(
  audience: "clients" | "leads",
  offset: number,
  limit: number
): Promise<string[]> {
  const audienceSql =
    audience === "clients"
      ? Prisma.sql`(
          (c."consultationBookingDate" IS NOT NULL AND c."consultationDeletedInAltegio" = false)
          OR c."paidServiceDate" IS NOT NULL
        )`
      : Prisma.sql`(
          c."includeInNewLeadsKpi" = true
          AND c."paidServiceDate" IS NULL
          AND (c."consultationBookingDate" IS NULL OR c."consultationDeletedInAltegio" = true)
        )`;
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT c.id
    FROM "direct_clients" c
    WHERE c.state IS DISTINCT FROM 'binotel-lead'
      AND c."instagramUsername" NOT LIKE 'binotel_%'
      AND c."instagramUsername" NOT LIKE 'missing_instagram_%'
      AND c."instagramUsername" NOT LIKE 'no_instagram_%'
      AND c."instagramUsername" NOT LIKE 'altegio_%'
      AND c."instagramUsername" NOT LIKE '\\_\\_no_ig\\_%'
      AND ${audienceSql}
    ORDER BY (
      SELECT MAX(m."receivedAt")
      FROM "direct_messages" m
      WHERE m."clientId" = c.id
        AND LOWER(COALESCE(m.source, 'manychat')) NOT IN ('telegram', 'telegram_campaign')
    ) DESC NULLS LAST, c.id ASC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return rows.map((row) => row.id);
}

/** Лід без живої консультації і без платної послуги, щоб не дублюватись у клієнтах. */
function leadWhere(): Prisma.DirectClientWhereInput {
  return {
    AND: [
      instagramWhere(),
      { includeInNewLeadsKpi: true },
      { paidServiceDate: null },
      { OR: [{ consultationBookingDate: null }, { consultationDeletedInAltegio: true }] },
    ],
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const auth = await getAuthContext(req);
  if (auth?.type === "user" && !hasPermission(auth.permissions, "messagesSection") && !hasPermission(auth.permissions, "leadsSection") && !hasPermission(auth.permissions, "statsSection")) {
    return NextResponse.json({ ok: false, error: "Немає доступу до розділу Переписки" }, { status: 403 });
  }

  try {
    const offsetRaw = Number(req.nextUrl.searchParams.get("offset") || "0");
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || String(PAGE_SIZE_DEFAULT));
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(limitRaw)))
      : PAGE_SIZE_DEFAULT;
    const audienceParam = req.nextUrl.searchParams.get("audience") || "leads";
    if (audienceParam !== "clients" && audienceParam !== "leads") {
      return NextResponse.json({ ok: false, error: "Невідома аудиторія переписок" }, { status: 400 });
    }
    const audience = audienceParam;
    const where = audience === "clients" ? clientWhere() : leadWhere();

    const [total, orderedIds, sources] = await Promise.all([
      prisma.directClient.count({ where }),
      findIdsByLastInstagramMessage(audience, offset, limit),
      prisma.leadSource.findMany({ select: { code: true, name: true } }),
    ]);
    const unordered = orderedIds.length
      ? await prisma.directClient.findMany({
          where: { id: { in: orderedIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            instagramUsername: true,
            firstContactDate: true,
            lastMessageAt: true,
            chatStatusId: true,
            chatStatusSetAt: true,
            chatStatusCheckedAt: true,
            leadAgency: true,
            leadAdId: true,
            spent: true,
            visits: true,
            altegioClientId: true,
          },
        })
      : [];
    const byId = new Map(unordered.map((row) => [row.id, row]));
    const rows = orderedIds.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));

    const sourceNameByCode = new Map(sources.map((source) => [source.code, source.name]));
    const mapped = rows.map((row) => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      instagramUsername: row.instagramUsername,
      firstContactDate: row.firstContactDate.toISOString(),
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      chatStatusId: row.chatStatusId,
      chatStatusSetAt: row.chatStatusSetAt ? row.chatStatusSetAt.toISOString() : null,
      chatStatusCheckedAt: row.chatStatusCheckedAt ? row.chatStatusCheckedAt.toISOString() : null,
      leadAgency: row.leadAgency,
      leadAdId: row.leadAdId,
      spent: row.spent,
      visits: row.visits,
      altegioClientId: row.altegioClientId,
      sourceName: row.leadAgency
        ? sourceNameByCode.get(row.leadAgency) || SOURCE_NAME_FALLBACK[row.leadAgency] || row.leadAgency
        : null,
    }));
    const withChat = await enrichClientsWithChannelChatMeta(mapped, "instagram");

    console.log(
      `[direct/messages] audience=${audience} сторінка offset=${offset} limit=${limit} віддано=${withChat.length} з ${total}`
    );

    return NextResponse.json({
      ok: true,
      total,
      offset,
      limit,
      clients: withChat,
    });
  } catch (err) {
    console.error("[direct/messages] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка завантаження переписок" },
      { status: 500 }
    );
  }
}
