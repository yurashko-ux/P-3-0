// POST { connectionId, paused }: призупинити / відновити підключення monobank.
// Призупинення знімає вебхук у monobank і вимикає синхронізацію виписок і балансів.
// Рахунки, банківські платежі та їхні зведення з Altegio не чіпаємо — історія лишається.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { deleteWebhook, setWebhook } from "@/lib/bank/monobank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Вебхук завжди на production (як у reregister-webhook)
const WEBHOOK_URL = "https://p-3-0.vercel.app/api/bank/monobank/webhook";

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const paused = body.paused === true;
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId обов'язковий" }, { status: 400 });
  }

  const connection = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, token: true, name: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Підключення не знайдено" }, { status: 404 });
  }

  if (paused) {
    // Спершу позначаємо паузу: навіть якщо monobank не зніме вебхук, вебхук-обробник платежі пропустить.
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { pausedAt: new Date() },
    });
    let webhookWarning: string | null = null;
    if (connection.token) {
      try {
        await deleteWebhook(connection.token);
        await prisma.bankConnection.update({ where: { id: connectionId }, data: { webhookUrl: null } });
      } catch (err) {
        webhookWarning = err instanceof Error ? err.message : String(err);
        console.warn("[bank/connections/pause] Вебхук у monobank не знято:", webhookWarning);
      }
    }
    console.log("[bank/connections/pause] Підключення призупинено", { connectionId, name: connection.name });
    return NextResponse.json({
      ok: true,
      paused: true,
      ...(webhookWarning
        ? { warning: `Призупинено, але вебхук у monobank зняти не вдалося (${webhookWarning}). Нові платежі все одно не прийматимуться.` }
        : {}),
    });
  }

  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: { pausedAt: null },
  });
  let webhookWarning: string | null = null;
  if (connection.token) {
    try {
      // Розігріваємо endpoint: monobank валідує його GET-запитом протягом 5 с
      await fetch(WEBHOOK_URL, { method: "GET" }).catch(() => undefined);
      await setWebhook(connection.token, WEBHOOK_URL);
      await prisma.bankConnection.update({ where: { id: connectionId }, data: { webhookUrl: WEBHOOK_URL } });
    } catch (err) {
      webhookWarning = err instanceof Error ? err.message : String(err);
      console.warn("[bank/connections/pause] Вебхук у monobank не зареєстровано:", webhookWarning);
    }
  }
  console.log("[bank/connections/pause] Підключення відновлено", { connectionId, name: connection.name });
  return NextResponse.json({
    ok: true,
    paused: false,
    ...(webhookWarning
      ? { warning: `Відновлено, але вебхук не зареєстровано (${webhookWarning}). Натисніть «Повторно зареєструвати».` }
      : {}),
  });
}
