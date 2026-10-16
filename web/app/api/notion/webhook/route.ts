import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { getNotionWebhookVerificationToken } from "@/lib/notion/env";
import { logNotionWebhook } from "@/lib/notion/notify";
import {
  asPayload,
  payloadJson,
  processNotionWebhookEvent,
  saveVerificationToken,
} from "@/lib/notion/process-event";
import { verifyNotionSignature } from "@/lib/notion/signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function schedule(rowId: string) {
  const task = processNotionWebhookEvent(rowId).catch((error) => {
    console.error("[notion/webhook] фонова обробка впала", rowId, error);
  });
  try {
    waitUntil(task);
  } catch (error) {
    console.error("[notion/webhook] waitUntil недоступний, подію підбере крон", error);
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  let parsed: unknown = null;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    console.warn("[notion/webhook] тіло не JSON");
    return NextResponse.json({ ok: false, error: "Некоректний JSON" }, { status: 400 });
  }

  const payload = asPayload(parsed);
  if (payload.verification_token && !payload.type) {
    try {
      await saveVerificationToken(payload.verification_token);
    } catch (error) {
      console.error("[notion/webhook] не вдалося зберегти verification_token", error);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    await logNotionWebhook({ kind: "verification" });
    return NextResponse.json({ ok: true });
  }

  const verificationToken = getNotionWebhookVerificationToken();
  const signature = req.headers.get("x-notion-signature");
  if (!verificationToken || !verifyNotionSignature(rawBody, signature, verificationToken)) {
    console.warn("[notion/webhook] підпис не зійшовся", { eventId: payload.id || null, type: payload.type || null });
    await logNotionWebhook({ kind: "signature_rejected", eventId: payload.id || null, type: payload.type || null });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!payload.id) {
    console.warn("[notion/webhook] подія без id");
    return NextResponse.json({ ok: false, error: "Немає id події" }, { status: 400 });
  }

  try {
    const row = await prisma.notionWebhookEvent.create({
      data: {
        notionEventId: payload.id,
        eventType: payload.type || "unknown",
        pageId: payload.entity?.id || null,
        payload: payloadJson(payload),
        status: "pending",
      },
    });
    console.log("[notion/webhook] подію збережено", { id: payload.id, type: payload.type || null });
    schedule(row.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      console.log("[notion/webhook] дубль події", payload.id);
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[notion/webhook] не вдалося зберегти подію", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
