// web/lib/binotel/call-record.ts
// Отримання посилання на запис дзвінка через Binotel stats/call-record
//
// ВАЖЛИВО: Завжди передавати validity та expiresIn (3600). Без них Binotel повертає
// закешоване посилання з моменту дзвінка → для старих дзвінків 403 Request has expired.
// Див. docs/BINOTEL_INTEGRATION.md та web/lib/binotel/README.md

import { sendRequest, isBinotelSuccess } from "./client";

/** Витягує URL запису з відповіді Binotel stats/call-record */
function extractRecordingUrlFromResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // callDetails може бути об'єктом { [generalCallID]: { url, link, ... } }
  const callDetails = d.callDetails;
  if (callDetails && typeof callDetails === "object") {
    const details = callDetails as Record<string, unknown>;
    const first = Object.values(details)[0];
    if (first && typeof first === "object") {
      const f = first as Record<string, unknown>;
      const candidates = [
        f.url,
        f.link,
        f.recordingUrl,
        f.recording,
        f.audio_url,
        f.recordUrl,
        (f as any)?.linkToCallRecordInMyBusiness,
        (f as any)?.linkToCallRecordOverlayInMyBusiness,
      ];
      for (const v of candidates) {
        if (typeof v === "string" && v.startsWith("http")) return v;
      }
    }
  }

  // Прямі поля у відповіді
  const topCandidates = [d.url, d.link, d.recordingUrl, d.recording];
  for (const v of topCandidates) {
    if (typeof v === "string" && v.startsWith("http")) return v;
  }

  return null;
}

/**
 * Отримує тимчасовий URL запису дзвінка з Binotel.
 * URL дійсний ~15 хвилин. Запис доступний лише для disposition: ANSWER, VM-SUCCESS, SUCCESS.
 */
export async function getCallRecordUrl(
  generalCallID: string
): Promise<{ url: string } | { error: string }> {
  const id = String(generalCallID).trim();
  if (!id) {
    return { error: "generalCallID обов'язковий" };
  }

  // validity/expiresIn/linkValidity — Binotel генерує presigned URL. Деякі версії API очікують різні назви.
  const res = await sendRequest("stats/call-record", {
    generalCallID: id,
    validity: 3600,
    expiresIn: 3600,
    linkValidity: 3600,
    validityPeriod: 3600,
    validFor: 3600,
  });

  if (!isBinotelSuccess(res)) {
    const msg = (res as { message?: string }).message || "Невідома помилка Binotel";
    return { error: msg };
  }

  const url = extractRecordingUrlFromResponse(res);
  if (!url) {
    return {
      error:
        "Binotel не повернув URL запису (можливо запис недоступний для цього дзвінка)",
    };
  }

  return { url };
}
