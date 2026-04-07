// web/app/api/bank/accounts/[accountId]/route.ts
// PATCH: оновити includeInOperationsTable для рахунку

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const { accountId } = await params;
  if (!accountId) {
    return NextResponse.json({ error: "Не вказано accountId" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const includeInOperationsTable =
      typeof body.includeInOperationsTable === "boolean" ? body.includeInOperationsTable : undefined;
    if (includeInOperationsTable === undefined) {
      return NextResponse.json(
        { error: "Відсутнє includeInOperationsTable (boolean)" },
        { status: 400 }
      );
    }

    await prisma.bankAccount.update({
      where: { id: accountId },
      data: { includeInOperationsTable },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, includeInOperationsTable });
  } catch (err) {
    console.error("[bank/accounts] PATCH error:", err);
    const message = err instanceof Error ? err.message : "Помилка оновлення";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
