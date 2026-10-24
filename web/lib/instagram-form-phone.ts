// Телефон з Instagram Instant Form / lead form (текст першого повідомлення Meta).

const PHONE_LABEL_RE =
  /(?:Phone number|Номер телефону|Телефон)\s*:\s*([+\d][\d\s\-()]{6,22}\d)/i;

/** Витягує номер з тексту форми Meta. Повертає нормалізований рядок або null. */
export function extractPhoneFromInstagramFormText(text: string | null | undefined): string | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  const match = raw.match(PHONE_LABEL_RE);
  if (!match?.[1]) return null;
  return normalizeUaPhoneForStorage(match[1]);
}

/** Зберігаємо цифри: 0XXXXXXXXX або +380XXXXXXXXX → 0XXXXXXXXX. */
export function normalizeUaPhoneForStorage(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 9) return null;
  if (digits.length === 12 && digits.startsWith("380")) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 11 && digits.startsWith("80")) {
    return `0${digits.slice(2)}`;
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return digits;
  }
  if (digits.length === 9) {
    return `0${digits}`;
  }
  // Інші формати — як є (лише цифри), якщо схоже на телефон.
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

/**
 * Якщо в тексті форми є телефон і в клієнта ще немає phone — записуємо в Direct.
 * Не перезаписує вже заповнений телефон.
 */
export async function maybeSavePhoneFromInstagramForm(params: {
  clientId: string;
  text: string | null | undefined;
  currentPhone?: string | null;
  update: (phone: string) => Promise<unknown>;
}): Promise<string | null> {
  if ((params.currentPhone || "").trim()) return null;
  const phone = extractPhoneFromInstagramFormText(params.text);
  if (!phone) return null;
  await params.update(phone);
  console.log("[instagram/form-phone] Телефон з форми Meta збережено в Direct", {
    clientId: params.clientId,
    phone,
  });
  return phone;
}
