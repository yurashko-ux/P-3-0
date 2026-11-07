import { NextRequest, NextResponse } from "next/server";
import { createKrescoPaymentPurpose } from "@/lib/finance/documents-kresco";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";

/** Створення статті доходу чи витрати в Креско (кнопка «+ Стаття» у картці платежу). */
export async function POST(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const purpose = await createKrescoPaymentPurpose({
      title: body.title,
      kind: body.kind,
      groupId: body.groupId,
    });
    return NextResponse.json({
      ok: true,
      purpose: {
        id: purpose.id,
        title: purpose.title,
        externalId: purpose.externalId,
        source: purpose.source,
        groupId: purpose.groupId,
      },
    });
  } catch (err) {
    console.error("[api/admin/finance/purposes] POST error:", err);
    const message = err instanceof Error ? err.message : "Не вдалося створити статтю";
    const status = /вкажіть|тип статті|оберіть групу|не знайдено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
