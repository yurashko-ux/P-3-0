import { NextRequest, NextResponse } from "next/server";
import {
  createFinanceOperation,
  leadAgencyLabel,
  listFinanceOperations,
  previewFinanceOperation,
  searchAppointmentsForOperation,
  FINANCE_OPERATION_METHOD_LABELS,
  type FinanceOperationMethod,
} from "@/lib/finance/operations";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

function methodLabel(method: string): string {
  if (method in FINANCE_OPERATION_METHOD_LABELS) {
    return FINANCE_OPERATION_METHOD_LABELS[method as FinanceOperationMethod];
  }
  return method;
}

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const appointmentId = String(req.nextUrl.searchParams.get("appointmentId") || "").trim();
    if (appointmentId) {
      const preview = await previewFinanceOperation(appointmentId);
      return NextResponse.json({ ok: true, preview });
    }
    if (req.nextUrl.searchParams.has("q")) {
      const appointments = await searchAppointmentsForOperation(req.nextUrl.searchParams.get("q") || "");
      return NextResponse.json({ ok: true, appointments });
    }
    const rows = await listFinanceOperations();
    const operations = rows.map((row) => ({
      id: row.id,
      kyivDay: row.kyivDay,
      amount: row.amount,
      method: row.method,
      methodLabel: methodLabel(row.method),
      clientName: row.clientName,
      appointmentId: row.appointmentId,
      leadAgency: row.leadAgency,
      leadAgencyLabel: leadAgencyLabel(row.leadAgency),
      consultationAt: row.consultationAt ? row.consultationAt.toISOString() : null,
      consultationMasterName: row.consultationMasterName,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      lines: row.lines.map((line) => ({
        id: line.id,
        title: line.title,
        amount: line.amount,
        staffName: line.staffName,
        altegioStaffId: line.altegioStaffId,
      })),
    }));
    return NextResponse.json({ ok: true, operations });
  } catch (err) {
    console.error("[api/admin/finance/operations] GET error:", err);
    const message = err instanceof Error ? err.message : "Помилка операцій";
    const status = /не знайдено/i.test(message) ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const operation = await createFinanceOperation(auth, {
      appointmentId: String(body.appointmentId || ""),
      amount: Number(body.amount),
      method: String(body.method || ""),
      kyivDay: String(body.kyivDay || ""),
    });
    return NextResponse.json({ ok: true, operation: { id: operation.id } });
  } catch (err) {
    console.error("[api/admin/finance/operations] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка збереження";
    const status = /вкажіть|спосіб|день|не знайдено|суму/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
