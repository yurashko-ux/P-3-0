// web/app/api/binotel/call-completed/route.ts
// Webhook: Binotel надсилає POST після завершення кожного дзвінка.
// Зберігає в direct_client_binotel_calls. Фільтр по BINOTEL_TARGET_LINE.
// URL для webhook у Binotel: https://p-3-0.vercel.app/api/binotel/call-completed

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kvWrite } from "@/lib/kv";
import { normalizePhone } from "@/lib/binotel/normalize-phone";
import { findOrCreateBinotelLead } from "@/lib/binotel/find-or-create-lead";

const BINOTEL_TARGET_LINE = process.env.BINOTEL_TARGET_LINE?.trim() || "0930007800";

/** IP серверів Binotel для опційної перевірки (з офіційних samples) */
const BINOTEL_IPS = new Set([
  "194.88.218.116", "194.88.218.114", "194.88.218.117", "194.88.218.118",
  "194.88.219.67", "194.88.219.78", "194.88.219.70", "194.88.219.71",
  "194.88.219.72", "194.88.219.79", "194.88.219.80", "194.88.219.81",
  "194.88.219.82", "194.88.219.83", "194.88.219.84", "194.88.219.85",
  "194.88.219.86", "194.88.219.87", "194.88.219.88", "194.88.219.89",
  "194.88.219.92", "194.88.218.119", "194.88.218.120",
  "185.100.66.145", "185.100.66.146", "185.100.66.147",
]);

export const dynamic = "force-dynamic";

function isCallOnTargetLine(call: Record<string, unknown>): boolean {
  const didNumber = (call.didNumber ?? (call as any).pbxNumberData?.number ?? "").toString().trim();
  if (didNumber) {
    return normalizePhone(didNumber) === normalizePhone(BINOTEL_TARGET_LINE);
  }
  return false; // порожній didNumber — пропускаємо
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip") || "";
  if (BINOTEL_IPS.size && ip && !BINOTEL_IPS.has(ip)) {
    console.warn("[binotel/call-completed] Запит з невідомого IP:", ip);
    // Не блокуємо — Vercel може не передавати реальний IP
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    const text = await req.text();
    console.log("[binotel/call-completed] Raw body (не JSON):", text?.slice(0, 500));
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  console.log("[binotel/call-completed] POST отримано:", JSON.stringify(body, null, 2).slice(0, 1000));

  // Зберігаємо усі вебхуки в KV для діагностики (включно з пропущеними через іншу лінію)
  try {
    const entry = {
      receivedAt: new Date().toISOString(),
      body,
    };
    await kvWrite.lpush("binotel:webhook:log", JSON.stringify(entry));
    await kvWrite.ltrim("binotel:webhook:log", 0, 99);
  } catch (err) {
    console.warn("[binotel/call-completed] Не вдалося зберегти вебхук у KV:", err);
  }

  if (!isCallOnTargetLine(body)) {
    console.log("[binotel/call-completed] Дзвінок не по цільовій лінії, пропускаємо");
    return NextResponse.json({ ok: true, skipped: true });
  }

  const generalCallID = String(body.generalCallID ?? body.callID ?? "").trim();
  const externalNumber = String(body.externalNumber ?? "").trim();
  const callType = body.callType === "0" || body.callType === 0 ? "incoming" : "outgoing";
  const disposition = String(body.disposition ?? "").trim() || "UNKNOWN";
  const startTime = body.startTime != null
    ? new Date(
        typeof body.startTime === "number"
          ? body.startTime * 1000
          : String(body.startTime)
      )
    : new Date();
  let durationSec: number | null = null;
  const billsec = body.billsec ?? body.duration;
  if (typeof billsec === "number" && billsec >= 0) durationSec = billsec;
  else if (typeof billsec === "string") durationSec = parseInt(billsec, 10) || null;

  if (!generalCallID) {
    console.warn("[binotel/call-completed] Немає generalCallID");
    return NextResponse.json({ ok: false, error: "Missing generalCallID" }, { status: 400 });
  }

  try {
    const existing = await prisma.directClientBinotelCall.findUnique({
      where: { generalCallID },
    });
    if (existing) {
      return NextResponse.json({ ok: true, existed: true });
    }

    const extNorm = normalizePhone(externalNumber) || externalNumber;
    let clientId: string | null = null;
    if (extNorm) {
      const clients = await prisma.directClient.findMany({
        where: { phone: { not: null } },
        select: { id: true, phone: true },
      });
      const found = clients.find((c) => c.phone && normalizePhone(c.phone) === extNorm);
      if (found) {
        clientId = found.id;
      } else {
        try {
          const startTimeDate = isNaN(startTime.getTime()) ? new Date() : startTime;
          clientId = await findOrCreateBinotelLead(externalNumber, startTimeDate);
        } catch (err) {
          console.error("[binotel/call-completed] findOrCreateBinotelLead:", err);
        }
      }
    }

    await prisma.directClientBinotelCall.create({
      data: {
        generalCallID,
        externalNumber: extNorm,
        clientId,
        callType,
        disposition,
        durationSec,
        startTime: isNaN(startTime.getTime()) ? new Date() : startTime,
        lineNumber: BINOTEL_TARGET_LINE,
        rawData: body as object,
      },
    });

    return NextResponse.json({ ok: true, created: true, clientId });
  } catch (e) {
    console.error("[binotel/call-completed] Помилка:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
