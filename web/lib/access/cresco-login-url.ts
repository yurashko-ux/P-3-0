// Посилання входу в Cresco CRM (дефолт для Доступів).
export const CRESCO_LOGIN_URL = "https://cresco-crm.vercel.app/admin/login";

/**
 * Посилання на мобільний журнал (веб PWA /admin/journal).
 * Бот @Zurnal_zapysiv_bot — окремий «Мій журнал» для майстрів (/master), не для посад на кшталт Маркетолог.
 * Окремий URL: NEXT_PUBLIC_CRESCO_MOBILE_APP_URL.
 */
export const CRESCO_MOBILE_APP_URL =
  process.env.NEXT_PUBLIC_CRESCO_MOBILE_APP_URL?.trim() ||
  "https://p-3-0.vercel.app/admin/journal";
