// Телефон з Instagram Instant Form / lead form (текст першого повідомлення Meta).

const PHONE_LABEL_RE =
  /(?:Phone number|Номер телефону|Телефон)\s*:\s*([+\d][\d\s\-()]{6,22}\d)/i;

const FULL_NAME_RE =
  /(?:Full name|Повне ім['’`]?я)\s*:\s*(.+?)(?=\s+(?:Phone number|Номер телефону|Телефон|Email|Ел\.?\s*пошта)\s*:|$)/i;

/** Імʼя з форми Meta. Перше слово — імʼя, решта — прізвище. */
export function extractFullNameFromInstagramFormText(
  text: string | null | undefined,
): { firstName: string; lastName: string | null } | null {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const match = raw.match(FULL_NAME_RE);
  const full = (match?.[1] || "").trim().replace(/[.,;]+$/, "");
  if (full.length < 2 || full.length > 80) return null;
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return {
    firstName: parts[0].slice(0, 80),
    lastName: parts.length > 1 ? parts.slice(1).join(" ").slice(0, 80) : null,
  };
}

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

export type InstagramFormCardPatch = {
  phone?: string;
  firstName?: string;
  lastName?: string | null;
};

/**
 * Дописує в картку телефон і імʼя з форми Meta, якщо цих полів ще немає.
 * Уже заповнені телефон і імʼя не перезаписує.
 */
export async function maybeSavePhoneFromInstagramForm(params: {
  clientId: string;
  text: string | null | undefined;
  currentPhone?: string | null;
  currentFirstName?: string | null;
  currentLastName?: string | null;
  update: (data: InstagramFormCardPatch) => Promise<unknown>;
}): Promise<InstagramFormCardPatch | null> {
  const data: InstagramFormCardPatch = {};
  if (!(params.currentPhone || "").trim()) {
    const phone = extractPhoneFromInstagramFormText(params.text);
    if (phone) data.phone = phone;
  }
  const hasName = Boolean((params.currentFirstName || "").trim() || (params.currentLastName || "").trim());
  if (!hasName) {
    const name = extractFullNameFromInstagramFormText(params.text);
    if (name) {
      data.firstName = name.firstName;
      data.lastName = name.lastName;
    }
  }
  if (!data.phone && !data.firstName) return null;
  await params.update(data);
  console.log("[instagram/form-phone] Дані форми Meta дописано в картку", {
    clientId: params.clientId,
    phone: Boolean(data.phone),
    name: Boolean(data.firstName),
  });
  return data;
}
