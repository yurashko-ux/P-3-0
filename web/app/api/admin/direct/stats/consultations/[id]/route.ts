// web/app/api/admin/direct/stats/consultations/[id]/route.ts
// Оновлення полів сторінки «Консультації»: майстер, коментар, ручна мітка результату.

import { NextRequest, NextResponse } from "next/server";
import { getDirectClient, saveDirectClient } from "@/lib/direct-store";
import { verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { getMasterColumnNamesLikeTable } from "@/lib/direct-master-column-names";
import type { DirectClient } from "@/lib/direct-types";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

const ALLOWED_OUTCOME_OVERRIDES = new Set([
  "planned",
  "thinking",
  "positive",
  "negative",
  "cancelled",
  "no_show",
  "",
]);

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

async function resolveParams(params: { id: string } | Promise<{ id: string }>): Promise<{ id: string }> {
  return typeof (params as Promise<{ id: string }>)?.then === "function"
    ? await (params as Promise<{ id: string }>)
    : (params as { id: string });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await resolveParams(params);
    const client = await getDirectClient(id);
    if (!client) {
      return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const updates: Partial<DirectClient> = {};

    if (Object.prototype.hasOwnProperty.call(body, "masterId")) {
      const raw = body.masterId;
      if (raw === null || raw === "") {
        updates.masterId = undefined;
        updates.masterManuallySet = true;
      } else if (typeof raw === "string" && raw.trim()) {
        const master = await prisma.directMaster.findFirst({
          where: { id: raw.trim(), isActive: true },
          select: { id: true },
        });
        if (!master) {
          return NextResponse.json({ ok: false, error: "Майстра не знайдено" }, { status: 400 });
        }
        updates.masterId = master.id;
        updates.masterManuallySet = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "consultationListComment")) {
      const raw = body.consultationListComment;
      updates.consultationListComment =
        raw == null || String(raw).trim() === "" ? null : String(raw).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, "consultationListOutcomeOverride")) {
      const raw = body.consultationListOutcomeOverride;
      const v = raw == null ? "" : String(raw).trim();
      if (!ALLOWED_OUTCOME_OVERRIDES.has(v)) {
        return NextResponse.json({ ok: false, error: "Невалідна мітка результату" }, { status: 400 });
      }
      updates.consultationListOutcomeOverride = v || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "Немає полів для оновлення" }, { status: 400 });
    }

    const updatedClient: DirectClient = { ...client, ...updates };

    await saveDirectClient(updatedClient, "consultation-list-manual-edit", {
      fields: Object.keys(updates),
    });

    const saved = (await getDirectClient(id)) || updatedClient;

    const masters = await prisma.directMaster.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    const masterNames = getMasterColumnNamesLikeTable(saved, masters);

    console.log("[stats/consultations PATCH] Оновлено клієнта:", {
      id: saved.id,
      fields: Object.keys(updates),
    });

    return NextResponse.json({
      ok: true,
      client: {
        id: saved.id,
        masterId: saved.masterId ?? null,
        masterDisplayName: masterNames.length > 0 ? masterNames.join(", ") : null,
        consultationListComment: saved.consultationListComment ?? null,
        consultationListOutcomeOverride: saved.consultationListOutcomeOverride ?? null,
      },
    });
  } catch (err) {
    console.error("[stats/consultations PATCH] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
