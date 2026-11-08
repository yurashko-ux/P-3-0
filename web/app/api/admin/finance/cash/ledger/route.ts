import { NextRequest, NextResponse } from "next/server";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";
import { listCashLedger } from "@/lib/finance/cash-posting";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Готівкові платежі і касовка, якою їх проведено. */
export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const rows = await listCashLedger();
    // Колонка «Запис» веде на запис у журналі Креско: один запит за номерами записів Altegio
    const recordIds = [...new Set(rows.map((row) => row.recordId).filter((id): id is number => Boolean(id)))];
    const appointments = recordIds.length
      ? await prisma.salonAppointment.findMany({
          where: { altegioRecordId: { in: recordIds } },
          select: { id: true, altegioRecordId: true },
        })
      : [];
    const appointmentByRecord = new Map(appointments.map((a) => [a.altegioRecordId, a.id]));
    return NextResponse.json({
      ok: true,
      rows: rows.map((row) => ({
        ...row,
        appointmentId: row.recordId ? appointmentByRecord.get(row.recordId) ?? null : null,
      })),
    });
  } catch (error) {
    console.error("[api/admin/finance/cash/ledger] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити готівку" },
      { status: 500 },
    );
  }
}
