// web/lib/direct-communication-channel.ts
// Канали комунікації для колонки «Комунікація» у Direct

export type DirectCommunicationChannel = "phone" | "instagram" | "telegram" | "viber" | "whatsapp";

export const DIRECT_COMMUNICATION_CHANNELS: ReadonlyArray<{
  value: DirectCommunicationChannel;
  labelUk: string;
  /** Іконка з public (скріни користувача: телефон, Instagram, Telegram, Viber, WhatsApp) */
  iconSrc: string;
}> = [
  { value: "phone", labelUk: "Телефон", iconSrc: "/assets/direct-communication/phone.png" },
  { value: "instagram", labelUk: "Instagram", iconSrc: "/assets/direct-communication/instagram.png" },
  { value: "telegram", labelUk: "Телеграм", iconSrc: "/assets/direct-communication/telegram.png" },
  { value: "viber", labelUk: "Вайбер", iconSrc: "/assets/direct-communication/viber.png" },
  { value: "whatsapp", labelUk: "WhatsApp", iconSrc: "/assets/direct-communication/whatsapp.png" },
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
