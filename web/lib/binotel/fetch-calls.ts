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

  const incoming = isBinotelSuccess(incomingRes)
    ? (incomingRes.callDetails ?? []) as BinotelCallRecord[]
    : [];
  const outgoing = isBinotelSuccess(outgoingRes)
    ? (outgoingRes.callDetails ?? []) as BinotelCallRecord[]
    : [];

  return { incoming, outgoing };
}
