import { NextRequest, NextResponse } from "next/server";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";
import {
  createFinanceDocument,
  listFinanceDocuments,
  listFinanceFormOptions,
} from "@/lib/finance/documents-kresco";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 50);
    const type = url.searchParams.get("type") || undefined;
    const withOptions = url.searchParams.get("options") === "1";

    const [documents, options] = await Promise.all([
      listFinanceDocuments({ limit, type: type || undefined }),
      withOptions ? listFinanceFormOptions() : Promise.resolve(null),
    ]);

    return NextResponse.json({
      ok: true,
      documents,
      ...(options ? { accounts: options.accounts, purposes: options.purposes } : {}),
    });
  } catch (err) {
    console.error("[api/admin/finance/documents] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка списку документів" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const document = await createFinanceDocument({
      ...body,
      createdBy: auth.userId || auth.type || null,
    });
    return NextResponse.json({ ok: true, document });
  } catch (err) {
    console.error("[api/admin/finance/documents] POST error:", err);
    const message = err instanceof Error ? err.message : "Помилка створення";
    const status = /оберіть|сума|тип|некоректн|потребує|не знайден/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
