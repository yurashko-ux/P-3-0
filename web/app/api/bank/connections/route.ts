// web/app/api/bank/connections/route.ts
// GET: список підключень та рахунків (без токена)

import { NextResponse } from "next/server";
import { prisma, getDbHostForLog } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// waitForReplica: затримка перед читанням (сек), щоб репліка встигла отримати дані після запису (Accelerate)
const MAX_WAIT_SEC = 5;

export async function GET(req: Request) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const waitSec = Math.min(MAX_WAIT_SEC, Math.max(0, parseInt(url.searchParams.get("waitForReplica") ?? "0", 10) || 0));
  if (waitSec > 0) {
    console.log("[bank/connections] GET waiting for replica:", waitSec, "s");
    await new Promise((r) => setTimeout(r, waitSec * 1000));
  }
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

    console.log("[bank/connections] returning count:", list.length, "| db:", getDbHostForLog());
    return NextResponse.json(
      { ok: true, connections: list },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (err) {
    console.error("[bank/connections] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка завантаження" },
      { status: 500 }
    );
  }
}
