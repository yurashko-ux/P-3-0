// web/app/api/binotel/call-completed/route.ts
// Webhook: Binotel надсилає POST після завершення кожного дзвінка.
// Зберігає в direct_client_binotel_calls. Фільтр по BINOTEL_TARGET_LINE.
// URL для webhook у Binotel: https://p-3-0.vercel.app/api/binotel/call-completed

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kvWrite } from "@/lib/kv";
import { normalizePhone } from "@/lib/binotel/normalize-phone";
import { findOrCreateBinotelLead } from "@/lib/binotel/find-or-create-lead";
import { parseFormToNested } from "@/lib/binotel/parse-form-brackets";

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

/** GET — деякі провайдери (у т.ч. Binotel) перевіряють URL через GET перед активацією вебхука */
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Binotel webhook endpoint active. POST to receive call-completed events.",
    timestamp: new Date().toISOString(),
  });
}

/** Обробляємо лише дзвінки, що йдуть на 0930007800 (вхідні) або виходять з цього номера (вихідні). Інші пропускаємо. */
function isCallOnTargetLine(call: Record<string, unknown>): boolean {
  const pbx = call.pbxNumberData as Record<string, unknown> | undefined;
  const didNumber = (call.didNumber ?? pbx?.number ?? "").toString().trim();
  if (didNumber) {
    return normalizePhone(didNumber) === normalizePhone(BINOTEL_TARGET_LINE);
  }
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip") || "";
  if (BINOTEL_IPS.size && ip && !BINOTEL_IPS.has(ip)) {
    console.warn("[binotel/call-completed] Запит з невідомого IP:", ip);
  }

  let body: Record<string, unknown> = {};
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      body = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const flat = Object.fromEntries(params) as Record<string, unknown>;
      // Binotel надсилає callDetails[generalCallID], callDetails[pbxNumberData][number] — конвертуємо у nested
      body = parseFormToNested(flat);
    } else {
      const text = await req.text();
      if (text?.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          console.log("[binotel/call-completed] Raw body (не JSON):", text?.slice(0, 500));
          return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
      }
    }
  } catch {
    const text = await req.text();
    console.log("[binotel/call-completed] Raw body (помилка парсингу):", text?.slice(0, 500));
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  console.log("[binotel/call-completed] POST отримано:", JSON.stringify(body, null, 2).slice(0, 1000));

  const call = (body.callDetails && typeof body.callDetails === "object"
    ? body.callDetails
    : body) as Record<string, unknown>;

  // Зберігаємо усі вебхуки в KV для діагностики
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

  if (!isCallOnTargetLine(call)) {
    console.log("[binotel/call-completed] Дзвінок не по цільовій лінії, пропускаємо");
    return NextResponse.json({ ok: true, skipped: true });
  }

  const generalCallID = String(call.generalCallID ?? call.callID ?? "").trim();
  const externalNumber = String(call.externalNumber ?? "").trim();
  const callType = call.callType === "0" || call.callType === 0 ? "incoming" : "outgoing";
  const disposition = String(call.disposition ?? "").trim() || "UNKNOWN";
  // Binotel надсилає startTime як Unix seconds (number або string "1773389322")
  let startTime: Date;
  if (call.startTime != null) {
    const ts = typeof call.startTime === "number" ? call.startTime : parseInt(String(call.startTime), 10);
    startTime = isNaN(ts) ? new Date() : new Date(ts * 1000);
  } else {
    startTime = new Date();
  }
  let durationSec: number | null = null;
  const billsec = call.billsec ?? call.duration;
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

    // Піднімаємо клієнта вгору в ACT (updatedAt + lastActivityAt)
    if (clientId) {
      await prisma.directClient.update({
        where: { id: clientId },
        data: {
          lastActivityAt: new Date(),
          lastActivityKeys: ["binotel_call"],
          updatedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ ok: true, created: true, clientId });
  } catch (e) {
    console.error("[binotel/call-completed] Помилка:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
