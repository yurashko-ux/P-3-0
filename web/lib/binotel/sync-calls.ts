// web/lib/binotel/sync-calls.ts
// Синхронізація історії дзвінків з Binotel в direct_client_binotel_calls.
// Викликається cron або вручну /api/admin/binotel/sync-calls. Фільтр по BINOTEL_TARGET_LINE.

import { prisma } from "@/lib/prisma";
import { fetchIncomingAndOutgoingForPeriod } from "./fetch-calls";
import type { BinotelCallRecord } from "./fetch-calls";
import { normalizePhone } from "./normalize-phone";
import { findOrCreateBinotelLead } from "./find-or-create-lead";

const BINOTEL_TARGET_LINE = process.env.BINOTEL_TARGET_LINE?.trim() || "0930007800";

function isCallOnTargetLine(call: BinotelCallRecord): boolean {
  const targetNorm = normalizePhone(BINOTEL_TARGET_LINE);
  const didNumber = (call.didNumber ?? (call as any).pbxNumberData?.number ?? "").toString().trim();
  if (didNumber) return normalizePhone(didNumber) === targetNorm;
  return true; // якщо поля немає — приймаємо
}

function toDbRecord(call: BinotelCallRecord): {
  generalCallID: string;
  externalNumber: string;
  callType: "incoming" | "outgoing";
  disposition: string;
  durationSec: number | null;
  startTime: Date;
  lineNumber: string | null;
  rawData: unknown;
} {
  const gid = String(call.generalCallID ?? call.callID ?? "").trim();
  const ext = String(call.externalNumber ?? "").trim();
  const callType = call.callType === "0" ? "incoming" : "outgoing";
  const disposition = String(call.disposition ?? "").trim() || "UNKNOWN";
  const startTime = call.startTime
    ? new Date(call.startTime * 1000)
    : new Date();

  let durationSec: number | null = null;
  const billsec = (call as any).billsec ?? (call as any).duration;
  if (typeof billsec === "number" && billsec >= 0) durationSec = billsec;
  else if (typeof billsec === "string") durationSec = parseInt(billsec, 10) || null;

  return {
    generalCallID: gid || `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    externalNumber: normalizePhone(ext) || ext,
    callType,
    disposition,
    durationSec,
    startTime,
    lineNumber: BINOTEL_TARGET_LINE,
    rawData: call,
  };
}

/** Макс. дзвінків за один запит — уникнення FUNCTION_INVOCATION_TIMEOUT на Vercel */
const DEFAULT_MAX_CALLS = 80;

export async function syncBinotelCallsToDb(
  startTime: number,
  stopTime: number,
  maxCalls: number = DEFAULT_MAX_CALLS
): Promise<{ synced: number; matched: number; skipped: number; errors: number; truncated?: boolean }> {
  const { incoming, outgoing } = await fetchIncomingAndOutgoingForPeriod(startTime, stopTime);

  const incomingFiltered = incoming.filter(isCallOnTargetLine);
  const allCalls = [
    ...incomingFiltered.map((c) => ({ ...c, _source: "incoming" as const })),
    ...outgoing.map((c) => ({ ...c, _source: "outgoing" as const })),
  ];

  // Перевіряємо, які generalCallID вже є в БД — одним запитом замість N findUnique
  const idsToCheck = allCalls
    .map((c) => String(c.generalCallID ?? c.callID ?? "").trim())
    .filter((id) => id && !id.startsWith("gen-"));
  const existingIds = new Set<string>();
  if (idsToCheck.length > 0) {
    const batch = idsToCheck.slice(0, Math.min(idsToCheck.length, 2000));
    const existing = await prisma.directClientBinotelCall.findMany({
      where: { generalCallID: { in: batch } },
      select: { generalCallID: true },
    });
    for (const r of existing) existingIds.add(r.generalCallID);
  }

  const clients = await prisma.directClient.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  });
  const phoneToClientId = new Map<string, string>();
  for (const c of clients) {
    if (c.phone) {
      const norm = normalizePhone(c.phone);
      if (norm && !phoneToClientId.has(norm)) phoneToClientId.set(norm, c.id);
    }
  }

  let synced = 0;
  let matched = 0;
  let skipped = 0;
  let errors = 0;

  for (const call of allCalls) {
    if (synced >= maxCalls) {
      return {
        synced,
        matched,
        skipped,
        errors,
        truncated: true,
      };
    }
    try {
      const rec = toDbRecord(call);
      if (!rec.generalCallID || rec.generalCallID.startsWith("gen-")) continue;

      if (existingIds.has(rec.generalCallID)) {
        skipped++;
        continue;
      }

      let clientId: string | null = rec.externalNumber ? phoneToClientId.get(rec.externalNumber) ?? null : null;
      if (!clientId && rec.externalNumber) {
        try {
          clientId = await findOrCreateBinotelLead(rec.externalNumber, rec.startTime);
          phoneToClientId.set(rec.externalNumber, clientId);
        } catch (err) {
          console.error("[binotel/sync-calls] findOrCreateBinotelLead:", err);
        }
      }
      if (clientId) matched++;

      await prisma.directClientBinotelCall.create({
        data: {
          generalCallID: rec.generalCallID,
          externalNumber: rec.externalNumber,
          callType: rec.callType,
          disposition: rec.disposition,
          durationSec: rec.durationSec,
          startTime: rec.startTime,
          lineNumber: rec.lineNumber,
          rawData: rec.rawData as object,
          ...(clientId && { clientId }),
        },
      });
      existingIds.add(rec.generalCallID);
      synced++;
    } catch (e) {
      console.error("[binotel/sync-calls] Помилка для дзвінка:", call.generalCallID, e);
      errors++;
    }
  }

  return { synced, matched, skipped, errors };
}
