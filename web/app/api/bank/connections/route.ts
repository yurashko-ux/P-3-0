// web/app/api/bank/connections/route.ts
// GET: список підключень та рахунків (без токена)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;
  console.log("[bank/connections] GET received, auth ok");

  try {
    const connections = await prisma.bankConnection.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        accounts: {
          select: {
            id: true,
            externalId: true,
            balance: true,
            currencyCode: true,
            type: true,
            iban: true,
            maskedPan: true,
          },
        },
      },
    });

    const list = connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      name: c.name,
      clientName: c.clientName,
      webhookUrl: c.webhookUrl,
      createdAt: c.createdAt.toISOString(),
      accounts: c.accounts.map((a) => ({
        ...a,
        balance: a.balance.toString(),
      })),
    }));

    return NextResponse.json({ ok: true, connections: list });
  } catch (err) {
    console.error("[bank/connections] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка завантаження" },
      { status: 500 }
    );
  }
}
