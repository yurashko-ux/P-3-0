// Посилання входу в Cresco CRM (дефолт для Доступів).
export const CRESCO_LOGIN_URL = "https://cresco-crm.vercel.app/admin/login";

/** Посилання на мобільний додаток Креско (йде в «Надіслати доступ»). ENV або поле у формі. */
export const CRESCO_MOBILE_APP_URL = process.env.NEXT_PUBLIC_CRESCO_MOBILE_APP_URL?.trim() || "";
