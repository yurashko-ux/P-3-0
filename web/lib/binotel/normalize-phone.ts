// web/lib/binotel/normalize-phone.ts
// Нормалізація номерів телефонів для зіставлення між Binotel, Altegio і Direct

/**
 * Приводить номер до формату 380XXXXXXXXX (без +, пробілів, дужок).
 * Приймає: 0930007800, +380930007800, 38 093 000 78 00, (093) 000-78-00
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (phone == null || typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("380") && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith("38") && digits.length >= 11) return "38" + digits.slice(2, 11);
  if (digits.startsWith("0") && digits.length >= 9) return "38" + digits;
  return digits;
}

/** Перевіряє, чи два номери збігаються після нормалізації */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb;
}
