// web/lib/binotel/fetch-calls.ts
// Отримання історії дзвінків з Binotel API

import { sendRequest, isBinotelSuccess } from "./client";

/** Один запис дзвінка з Binotel callDetails */
export interface BinotelCallRecord {
  generalCallID?: string;
  callID?: string;
  disposition?: string;
  callType?: string; // '0' = вхідний, інше = вихідний
  externalNumber?: string;
  internalNumber?: string;
  startTime?: number; // Unix timestamp
  historyData?: Array<{ internalNumber?: string; [k: string]: unknown }>;
  // Можливі поля для фільтрації по лінії (потрібно перевірити в raw)
  didNumber?: string;
  pbxNumberData?: { number?: string; name?: string };
  [key: string]: unknown;
}

/** Відповідь Binotel для stats (incoming/outgoing) */
interface BinotelCallsResponse {
  callDetails?: BinotelCallRecord[];
}

/**
 * Запитує вхідні та вихідні дзвінки за період.
 * Binotel обмежує період до 24 год для list-of-calls-for-period;
 * для incoming/outgoing обмежень немає в docs, але рекомендовано дрібні інтервали.
 */
export async function fetchIncomingAndOutgoingForPeriod(
  startTime: number,
  stopTime: number
): Promise<{ incoming: BinotelCallRecord[]; outgoing: BinotelCallRecord[] }> {
  const [incomingRes, outgoingRes] = await Promise.all([
    sendRequest<BinotelCallsResponse>("stats/incoming-calls-for-period", {
      startTime,
      stopTime,
    }),
    sendRequest<BinotelCallsResponse>("stats/outgoing-calls-for-period", {
      startTime,
      stopTime,
    }),
  ]);

  function toArray(val: unknown): BinotelCallRecord[] {
    if (Array.isArray(val)) return val as BinotelCallRecord[];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.values(val) as BinotelCallRecord[];
    }
    return [];
  }

  const incoming = isBinotelSuccess(incomingRes)
    ? toArray(incomingRes.callDetails)
    : [];
  const outgoing = isBinotelSuccess(outgoingRes)
    ? toArray(outgoingRes.callDetails)
    : [];

  return { incoming, outgoing };
}
