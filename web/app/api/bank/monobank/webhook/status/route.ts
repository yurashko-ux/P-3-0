// web/app/api/bank/monobank/webhook/status/route.ts
// GET: що збережено в Monobank як webHookUrl (з client-info) — діагностика

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { fetchClientInfo } from "@/lib/bank/monobank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBaseUrl(): string {
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://p-3-0.vercel.app";
}

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const connectionId = req.nextUrl.searchParams.get("connectionId")?.trim();
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId обов'язковий" }, { status: 400 });
  }

  try {
    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId },
      select: { id: true, token: true, name: true, webhookUrl: true },
    });
    if (!connection || !connection.token) {
      return NextResponse.json({ error: "Підключення не знайдено" }, { status: 404 });
    }

    const clientInfo = await fetchClientInfo(connection.token);
    const ourUrl = `${getBaseUrl()}/api/bank/monobank/webhook`;
    const monobankStoredUrl = clientInfo.webHookUrl ?? "";

    return NextResponse.json({
      ok: true,
      connectionId,
      ourUrl,
      monobankStoredUrl,
      match: monobankStoredUrl === ourUrl,
      savedInDb: connection.webhookUrl,
    });
  } catch (err) {
    console.error("[bank/monobank/webhook/status] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка (можливо, обмеження 1 раз / 60 с)" },
      { status: 500 }
    );
  }
}
