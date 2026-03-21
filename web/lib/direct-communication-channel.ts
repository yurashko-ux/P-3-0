// web/lib/direct-communication-channel.ts
// Канали комунікації для колонки «Комунікація» у Direct

export type DirectCommunicationChannel = "phone" | "instagram" | "telegram" | "viber" | "whatsapp";

export const DIRECT_COMMUNICATION_CHANNELS: ReadonlyArray<{
  value: DirectCommunicationChannel;
  labelUk: string;
  emoji: string;
}> = [
  { value: "phone", labelUk: "Телефон", emoji: "📞" },
  { value: "instagram", labelUk: "Instagram", emoji: "📷" },
  { value: "telegram", labelUk: "Телеграм", emoji: "✈️" },
  { value: "viber", labelUk: "Вайбер", emoji: "💜" },
  { value: "whatsapp", labelUk: "WhatsApp", emoji: "💬" },
] as const;

const ALLOWED = new Set<string>(DIRECT_COMMUNICATION_CHANNELS.map((c) => c.value));

/** Перевірка значення з API/UI перед збереженням */
export function isDirectCommunicationChannel(v: unknown): v is DirectCommunicationChannel {
  return typeof v === "string" && ALLOWED.has(v);
}

/** PATCH: поле передано явно — нормалізуємо в null або валідний ключ */
export function parseCommunicationChannelForPatch(
  raw: unknown
): { ok: true; value: DirectCommunicationChannel | null } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, error: "communicationChannel має бути рядком або null" };
  }
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  if (!ALLOWED.has(t)) {
    return {
      ok: false,
      error: "Недопустиме значення communicationChannel (дозволено: phone, instagram, telegram, viber, whatsapp)",
    };
  }
  return { ok: true, value: t as DirectCommunicationChannel };
}
