// web/app/api/bank/monobank/connect/route.ts
// POST: додати підключення monobank (токен), отримати рахунки, зареєструвати webhook

import { NextRequest, NextResponse } from "next/server";
import { prisma, getDbHostForLog } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { fetchClientInfo, setWebhook } from "@/lib/bank/monobank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBaseUrl(): string {
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://p-3-0.vercel.app";
}

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) {
    console.log("[bank/monobank/connect] POST auth failed, status:", (auth as NextResponse).status);
    return auth;
  }
  console.log("[bank/monobank/connect] POST received, auth ok");

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() || "Monobank" : "Monobank";

    if (!token) {
      return NextResponse.json({ error: "Токен обов'язковий" }, { status: 400 });
    }

    const clientInfo = await fetchClientInfo(token);
    const webhookUrl = `${getBaseUrl()}/api/bank/monobank/webhook`;
    await setWebhook(token, webhookUrl);

    const connection = await prisma.bankConnection.create({
      data: {
        provider: "monobank",
        name,
        token,
        webhookUrl,
        clientName: clientInfo.name ?? null,
        clientId: clientInfo.clientId ?? null,
      },
    });

    const accounts = clientInfo.accounts ?? [];
    for (const acc of accounts) {
      const maskedPan =
        Array.isArray(acc.maskedPan) && acc.maskedPan.length > 0
          ? acc.maskedPan[0]
          : acc.iban ?? null;

      await prisma.bankAccount.upsert({
        where: {
          connectionId_externalId: {
            connectionId: connection.id,
            externalId: String(acc.id),
          },
        },
        create: {
          connectionId: connection.id,
          externalId: String(acc.id),
          balance: BigInt(acc.balance ?? 0),
          currencyCode: acc.currencyCode ?? 980,
          type: acc.type ?? null,
          iban: acc.iban ?? null,
          maskedPan: maskedPan ?? null,
          sendId: acc.sendId ?? null,
          cashbackType: acc.cashbackType ?? null,
        },
        update: {
          balance: BigInt(acc.balance ?? 0),
          currencyCode: acc.currencyCode ?? 980,
          type: acc.type ?? null,
          iban: acc.iban ?? null,
          maskedPan: maskedPan ?? null,
          sendId: acc.sendId ?? null,
          cashbackType: acc.cashbackType ?? null,
        },
      });
    }

    const accountsList = await prisma.bankAccount.findMany({
      where: { connectionId: connection.id },
      select: {
        id: true,
        externalId: true,
        balance: true,
        currencyCode: true,
        type: true,
        iban: true,
        maskedPan: true,
      },
    });

    // Перевірка, що запис видно в БД одразу після створення (діагностика проблеми "пусто після повторного логіну")
    const verifyCount = await prisma.bankConnection.count();
    const verifyThis = await prisma.bankConnection.findUnique({
      where: { id: connection.id },
      select: { id: true },
    });
    console.log("[bank/monobank/connect] success, connection id:", connection.id, "| verify same request:", verifyThis ? "ok" : "MISSING", "| total in DB:", verifyCount, "| db:", getDbHostForLog());
    return NextResponse.json({
      ok: true,
      connection: {
        id: connection.id,
        name: connection.name,
        provider: connection.provider,
        clientName: connection.clientName,
        webhookUrl: connection.webhookUrl,
      },
      accounts: accountsList.map((a) => ({
        ...a,
        balance: a.balance.toString(),
      })),
    });
  } catch (err) {
    console.error("[bank/monobank/connect] error:", err);
    const message = err instanceof Error ? err.message : "Помилка підключення";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
