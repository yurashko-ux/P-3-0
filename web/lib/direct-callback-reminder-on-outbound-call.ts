// web/lib/direct-callback-reminder-on-outbound-call.ts
// Закриття циклу «передзвонити»: успішний вихідний дзвінок у день дедлайну або після — у колонці 📞, у історії запис з 📞 та датою останнього дедлайну.

import type { CallbackReminderHistoryEntry, DirectClient } from "@/lib/direct-types";
import { getDirectClient, saveDirectClient } from "@/lib/direct-store";

const KYIV_TZ = "Europe/Kyiv";

/** Як у CallbackReminderCell — успішне з’єднання */
const BINOTEL_SUCCESS = ["ANSWER", "VM-SUCCESS", "SUCCESS"];

function kyivYmdFromDate(d: Date): string {
  try {
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: KYIV_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

export type ApplyCallbackReminderCloseArgs = {
  clientId: string;
  callStartTime: Date;
  callType: string;
  disposition: string;
  durationSec: number | null;
};

/**
 * Якщо є активний дедлайн передзвону і це успішний вихідний дзвінок у день дедлайну або пізніше —
 * додаємо запис у історію (note 📞, scheduledKyivDay = останній дедлайн), очищаємо поточну дату/нотатку (у UI — 📞).
 * Ідемпотентно: при відсутності дедлайну нічого не робить (повторні вебхуки безпечні).
 */
export async function applyCallbackReminderCloseOnSuccessfulOutboundCall(
  args: ApplyCallbackReminderCloseArgs
): Promise<{ applied: boolean; reason?: string }> {
  const { clientId, callStartTime, callType, disposition, durationSec } = args;
  if (!clientId?.trim()) return { applied: false, reason: "no clientId" };
  if (callType !== "outgoing") return { applied: false, reason: "not outgoing" };
  const disp = String(disposition ?? "").trim();
  if (!BINOTEL_SUCCESS.includes(disp)) return { applied: false, reason: "not success disposition" };
  if (durationSec !== null && durationSec !== undefined && durationSec <= 0) {
    return { applied: false, reason: "zero duration" };
  }

  const client = await getDirectClient(clientId);
  if (!client) return { applied: false, reason: "client not found" };

  const deadline = (client.callbackReminderKyivDay ?? "").trim();
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return { applied: false, reason: "no active deadline" };
  }

  const callKyivYmd = kyivYmdFromDate(callStartTime);
  if (!callKyivYmd) return { applied: false, reason: "bad call time" };
  if (callKyivYmd < deadline) {
    return { applied: false, reason: "call before deadline day" };
  }

  const nowIso = new Date().toISOString();
  const entry: CallbackReminderHistoryEntry = {
    createdAt: nowIso,
    scheduledKyivDay: deadline,
    note: "📞",
  };
  const prev = Array.isArray(client.callbackReminderHistory) ? client.callbackReminderHistory : [];
  const nextHistory: CallbackReminderHistoryEntry[] = [...prev, entry];

  const mergedActivityKeys = [
    ...new Set([...(client.lastActivityKeys ?? []), "callbackReminder", "binotel_call"]),
  ];

  const updated: DirectClient = {
    ...client,
    callbackReminderHistory: nextHistory,
    callbackReminderKyivDay: null,
    callbackReminderNote: null,
    lastActivityAt: nowIso,
    lastActivityKeys: mergedActivityKeys,
  };

  await saveDirectClient(updated, "callback-reminder-cycle-closed-outbound", { clientId }, { touchUpdatedAt: false });
  console.log(
    `[direct-callback-reminder] Цикл передзвону закрито: clientId=${clientId} deadline=${deadline} callKyivDay=${callKyivYmd} disposition=${disp}`
  );
  return { applied: true };
}
