import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Плитка «Завдатки» в Касі: сума залишків клієнтів > 0 з останнього знімка «Рахунки клієнта» Altegio (один запит). */
export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await prisma.clientDepositAccount.aggregate({
      where: { altegioBalance: { gt: 0 } },
      _sum: { altegioBalance: true },
      _count: { _all: true },
      _max: { altegioBalanceAt: true },
    });
    return NextResponse.json({
      ok: true,
      total: Math.round((result._sum.altegioBalance ?? 0) * 100) / 100,
      clients: result._count._all,
      snapshotAt: result._max.altegioBalanceAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("[finance/cash/deposits-total] Помилка:", error);
    return NextResponse.json({ ok: false, error: "Не вдалося порахувати завдатки" }, { status: 500 });
  }
}
