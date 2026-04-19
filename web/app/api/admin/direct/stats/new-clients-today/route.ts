// web/app/api/admin/direct/stats/new-clients-today/route.ts
// Нові клієнти за день (Kyiv): firstContactDate у межах дня — те саме, що newLeadsCount у statsOnly (GET clients).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKyivDayUtcBounds, getTodayKyiv } from "@/lib/direct-stats-config";
import { verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dayParam = req.nextUrl.searchParams.get("day") || "";
    const todayKyiv = getTodayKyiv(dayParam);
    const { startUtc, endUtc } = getKyivDayUtcBounds(todayKyiv);

    const includeClients =
      req.nextUrl.searchParams.get("includeClients") === "1" ||
      req.nextUrl.searchParams.get("includeClients") === "true";

    const where = {
      firstContactDate: {
        gte: startUtc,
        lt: endUtc,
      },
      includeInNewLeadsKpi: true,
    };

    const [today, clients] = await Promise.all([
      prisma.directClient.count({ where }),
      includeClients
        ? prisma.directClient.findMany({
            where,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              instagramUsername: true,
              firstContactDate: true,
            },
            orderBy: { firstContactDate: "desc" },
          })
        : Promise.resolve(null),
    ]);

    console.log("[new-clients-today] Підрахунок за firstContactDate (Kyiv):", {
      todayKyiv,
      startUtc: startUtc.toISOString(),
      endUtc: endUtc.toISOString(),
      today,
      includeClients,
    });

    return NextResponse.json({
      ok: true,
      todayKyiv,
      /** Кількість клієнтів з першим контактом у цей київський день */
      today,
      ...(includeClients && clients
        ? {
            clientsToday: clients.map((c) => ({
              id: c.id,
              firstName: c.firstName,
              lastName: c.lastName,
              instagramUsername: c.instagramUsername,
              firstContactDate: c.firstContactDate.toISOString(),
            })),
          }
        : {}),
    });
  } catch (err) {
    console.error("[new-clients-today] Помилка:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
