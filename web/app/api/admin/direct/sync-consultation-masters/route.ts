// web/app/api/admin/direct/sync-consultation-masters/route.ts
// Оновлює consultationMasterName з KV / Visit Details для клієнтів з відбулою консультацією.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { verifyUserToken } from "@/lib/auth-rbac";
import {
  applyConsultationMasterSync,
  loadAllConsultGroupsByClient,
  type ConsultationMasterClientRef,
  type ConsultationMasterFieldUpdates,
} from "@/lib/direct-consultation-master-sync";
import { isNonConsultantStaffName } from "@/lib/altegio/records-grouping";
import { mapStaffNameToExcelKey } from "@/lib/direct-leads-masters-stats";
import {
  getDirectMasterById,
  getMasterByAltegioStaffId,
  getMasterByName,
} from "@/lib/direct-masters/store";

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

function toBool(v: string | null): boolean {
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function hasValidConsultationMasterName(name: string | null | undefined): boolean {
  const prev = (name || "").trim();
  if (!prev) return false;
  if (isNonConsultantStaffName(prev)) return false;
  return mapStaffNameToExcelKey(prev) != null;
}

async function saveConsultationMasterUpdates(
  clientId: string,
  updates: ConsultationMasterFieldUpdates
): Promise<void> {
  if (Object.keys(updates).length === 0) return;
  await prisma.directClient.update({
    where: { id: clientId },
    data: updates,
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const force = toBool(req.nextUrl.searchParams.get("force"));
    const clientIdsParam = (req.nextUrl.searchParams.get("clientIds") || "").trim();
    const clientIdsFilter = clientIdsParam
      ? new Set(
          clientIdsParam
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        )
      : null;

    const clients = await prisma.directClient.findMany({
      where: {
        consultationAttended: true,
        consultationDeletedInAltegio: false,
        ...(clientIdsFilter
          ? { id: { in: [...clientIdsFilter] } }
          : {}),
      },
      select: {
        id: true,
        altegioClientId: true,
        consultationBookingDate: true,
        consultationMasterName: true,
        consultationMasterId: true,
        masterId: true,
        masterManuallySet: true,
      },
    });

    let checked = 0;
    let updated = 0;
    let skippedNoAltegio = 0;
    let skippedNoPick = 0;
    let errors = 0;

    const deps = {
      getMasterByName,
      getMasterByAltegioStaffId,
      getMasterById: getDirectMasterById,
      saveClient: async (
        c: ConsultationMasterClientRef & Record<string, unknown>,
        _source: string,
        meta: Record<string, unknown>
      ) => {
        const updates = (meta.updates || {}) as ConsultationMasterFieldUpdates;
        await saveConsultationMasterUpdates(c.id, updates);
      },
    };

    const groupsByClient = await loadAllConsultGroupsByClient();

    for (const c of clients) {
      if (!c.altegioClientId) {
        skippedNoAltegio++;
        continue;
      }
      checked++;

      const prev = (c.consultationMasterName || "").trim();
      if (!force && hasValidConsultationMasterName(prev)) {
        continue;
      }

      try {
        const result = await applyConsultationMasterSync(c, undefined, deps, groupsByClient);
        if (!result.pick) {
          skippedNoPick++;
          continue;
        }
        if (result.updated) updated++;
      } catch (err) {
        errors++;
        console.error("[sync-consultation-masters] Помилка для клієнта:", c.id, err);
      }
    }

    console.log("[sync-consultation-masters] Завершено:", {
      checked,
      updated,
      skippedNoAltegio,
      skippedNoPick,
      errors,
    });

    return NextResponse.json({
      ok: true,
      results: {
        total: clients.length,
        checked,
        updated,
        skippedNoAltegio,
        skippedNoPick,
        errors,
      },
    });
  } catch (err) {
    console.error("[sync-consultation-masters] Помилка:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
