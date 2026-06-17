import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchAltegioAccounts } from "@/lib/altegio/accounts";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const bankAccountId = typeof body.bankAccountId === "string" ? body.bankAccountId.trim() : "";
    const altegioAccountId =
      typeof body.altegioAccountId === "string" ? body.altegioAccountId.trim() : "";

    if (!bankAccountId) {
      return NextResponse.json({ ok: false, error: "Потрібен bankAccountId" }, { status: 400 });
    }

    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: {
        id: true,
        iban: true,
        maskedPan: true,
        includeInOperationsTable: true,
        connection: { select: { clientName: true } },
      },
    });

    if (!bankAccount) {
      return NextResponse.json({ ok: false, error: "Monobank-рахунок не знайдено" }, { status: 404 });
    }

    if (!altegioAccountId) {
      const updated = await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          altegioAccountId: null,
          altegioAccountTitle: null,
          altegioSyncError: null,
        },
        select: {
          id: true,
          altegioAccountId: true,
          altegioAccountTitle: true,
        },
      });

      console.log("[admin/altegio/bank-accounts-link] Прив'язку знято:", {
        bankAccountId,
        clientName: bankAccount.connection.clientName,
      });

      return NextResponse.json({
        ok: true,
        cleared: true,
        bankAccount: updated,
      });
    }

    const altegioAccounts = await fetchAltegioAccounts();
    const matched = altegioAccounts.find((account) => account.id === altegioAccountId) ?? null;

    if (!matched) {
      return NextResponse.json(
        {
          ok: false,
          error: `Altegio account_id=${altegioAccountId} не знайдено у /accounts`,
        },
        { status: 400 },
      );
    }

    const updated = await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        altegioAccountId: matched.id,
        altegioAccountTitle: matched.title,
        altegioSyncError: null,
      },
      select: {
        id: true,
        altegioAccountId: true,
        altegioAccountTitle: true,
      },
    });

    console.log("[admin/altegio/bank-accounts-link] Збережено прив'язку:", {
      bankAccountId,
      clientName: bankAccount.connection.clientName,
      altegioAccountId: matched.id,
      altegioAccountTitle: matched.title,
    });

    return NextResponse.json({
      ok: true,
      bankAccount: updated,
      altegioAccountId: matched.id,
      altegioAccountTitle: matched.title,
    });
  } catch (error) {
    console.error("[admin/altegio/bank-accounts-link] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
