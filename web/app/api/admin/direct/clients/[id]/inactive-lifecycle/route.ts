// GET /api/admin/direct/clients/[id]/inactive-lifecycle — історія entered/restored

import { NextRequest, NextResponse } from "next/server";
import { isInactiveBaseAuthorized } from "@/lib/inactive-base/auth";
import { listInactiveLifecycleEventsForClient } from "@/lib/inactive-base/lifecycle-events";
import { enrichClientWithLifecycle } from "@/lib/inactive-base/lifecycle";
import { getDirectClient } from "@/lib/direct-store";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function resolveParams(
  params: { id: string } | Promise<{ id: string }>
): Promise<{ id: string }> {
  return typeof (params as Promise<{ id: string }>)?.then === "function"
    ? await (params as Promise<{ id: string }>)
    : (params as { id: string });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: clientId } = await resolveParams(ctx.params);
  const trimmed = String(clientId || "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Немає clientId" }, { status: 400 });
  }

  try {
    const events = await listInactiveLifecycleEventsForClient(trimmed);
    const client = await getDirectClient(trimmed);
    const today = kyivDayFromISO(new Date().toISOString());
    const lifecycle = client
      ? enrichClientWithLifecycle(client as any, today)
      : null;

    let merged = events;
    if (merged.length === 0 && lifecycle) {
      const synthetic: typeof events = [];
      if (lifecycle.inactiveSinceKyivDay) {
        synthetic.push({
          id: `synth-entered-${lifecycle.inactiveSinceKyivDay}`,
          clientId: trimmed,
          type: "entered",
          kyivDay: lifecycle.inactiveSinceKyivDay,
          source: "computed",
          metadata: null,
          createdAt: new Date().toISOString(),
        });
      }
      if (
        lifecycle.inactiveLifecycleStatus === "restored" &&
        lifecycle.restoredAtKyivDay
      ) {
        synthetic.push({
          id: `synth-restored-${lifecycle.restoredAtKyivDay}`,
          clientId: trimmed,
          type: "restored",
          kyivDay: lifecycle.restoredAtKyivDay,
          source: "computed",
          metadata: null,
          createdAt: new Date().toISOString(),
        });
      }
      merged = synthetic.sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
    }

    return NextResponse.json({
      ok: true,
      events: merged,
      lifecycle: lifecycle
        ? {
            status: lifecycle.inactiveLifecycleStatus,
            inactiveSinceKyivDay: lifecycle.inactiveSinceKyivDay,
            restoredAtKyivDay: lifecycle.restoredAtKyivDay,
            exitDaysDisplay: lifecycle.exitDaysDisplay,
            liveDaysSinceLastVisit: lifecycle.liveDaysSinceLastVisit,
          }
        : null,
    });
  } catch (err) {
    console.error("[inactive-lifecycle] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка" },
      { status: 500 }
    );
  }
}
