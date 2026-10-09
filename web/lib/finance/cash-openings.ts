// Початкові залишки готівки на кінець дня. Рухи Kresco рахуємо з наступного дня.

export const CASH_OPENING_KYIV_DAY = "2026-10-08";

/** Касовкою зводимо готівку з цього дня. Раніші платежі вже всередині початкового залишку. */
export const CASH_RECONCILE_FROM_KYIV_DAY = "2026-10-09";

export const CASH_OPENING_UAH: number | null = 473315;
export const CASH_OPENING_USD: number | null = 2000;
export const CASH_OPENING_EUR: number | null = 600;
