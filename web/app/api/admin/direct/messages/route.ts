// Список лідів без консультації для розділу «Переписки».
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

function leadWhere(): Prisma.DirectClientWhereInput {
  return {
    includeInNewLeadsKpi: true,
    NOT: [
      { state: "binotel-lead" },
      ...TECHNICAL_USERNAME_PREFIXES.map((prefix) => ({
        instagramUsername: { startsWith: prefix },
      })),
    ],
    OR: [{ consultationBookingDate: null }, { consultationDeletedInAltegio: true }],
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const auth = await getAuthContext(req);
  if (auth?.type === "user" && !hasPermission(auth.permissions, "messagesSection")) {
    return NextResponse.json({ ok: false, error: "Немає доступу до розділу Переписки" }, { status: 403 });
  }

  try {
    const offsetRaw = Number(req.nextUrl.searchParams.get("offset") || "0");
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || String(PAGE_SIZE_DEFAULT));
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(limitRaw)))
      : PAGE_SIZE_DEFAULT;
    const where = leadWhere();

    const [total, rows] = await Promise.all([
      prisma.directClient.count({ where }),
      prisma.directClient.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
        skip: offset,
        take: limit,
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
        },
      }),
    ]);

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
    }));
    const withChat = await enrichClientsWithChannelChatMeta(mapped, "instagram");

    console.log(
      `[direct/messages] Сторінка offset=${offset} limit=${limit} віддано=${withChat.length} з ${total}`
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
