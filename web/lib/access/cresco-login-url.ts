// Посилання входу в Cresco CRM (дефолт для Доступів).
export const CRESCO_LOGIN_URL = "https://cresco-crm.vercel.app/admin/login";

/**
 * Посилання на мобільний доступ Креско (йде в «Надіслати доступ»).
 * За замовчуванням — той самий логін (веб працює з телефону).
 * Окремий store/app URL: NEXT_PUBLIC_CRESCO_MOBILE_APP_URL.
 */
export const CRESCO_MOBILE_APP_URL =
  process.env.NEXT_PUBLIC_CRESCO_MOBILE_APP_URL?.trim() || CRESCO_LOGIN_URL;
