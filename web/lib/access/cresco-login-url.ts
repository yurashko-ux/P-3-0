// Посилання входу в Cresco CRM (дефолт для Доступів).
export const CRESCO_LOGIN_URL = "https://cresco-crm.vercel.app/admin/login";

/**
 * Мобільний журнал для користувачів з Доступів (логін + пароль).
 * Відкриває веб PWA на домені cresco — не p-3-0 і не Telegram-бот майстрів.
 * Окремий URL: NEXT_PUBLIC_CRESCO_MOBILE_APP_URL.
 */
export const CRESCO_MOBILE_APP_URL =
  process.env.NEXT_PUBLIC_CRESCO_MOBILE_APP_URL?.trim() ||
  "https://cresco-crm.vercel.app/admin/journal";

/** Чи шлях — вхід саме в мобільний журнал (після логіну лишаємось у журналі). */
export function isMobileJournalPath(path: string): boolean {
  const p = String(path || "").trim();
  return p === "/admin/journal" || p.startsWith("/admin/journal?") || p.startsWith("/admin/journal/");
}