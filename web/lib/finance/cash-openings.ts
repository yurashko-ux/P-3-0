// Початкові залишки готівки на кінець дня. Рухи Kresco й Altegio рахуємо з наступного дня.
// Старт з нуля 04.11.2026 (стара схема з проводкою касовкою — з 08.10.2026).

export const CASH_OPENING_KYIV_DAY = "2026-11-04";

/** Баланс каси = старт + усі рухи з цього дня. Раніші платежі вже всередині початкового залишку. */
export const CASH_RECONCILE_FROM_KYIV_DAY = "2026-11-05";

export const CASH_OPENING_UAH: number | null = 86384;
export const CASH_OPENING_USD: number | null = 630;
export const CASH_OPENING_EUR: number | null = 0;

/** Історія готівки у вкладці Платежі показується з цього дня (у баланс іде лише з CASH_RECONCILE_FROM_KYIV_DAY). */
export const CASH_LEDGER_HISTORY_FROM_KYIV_DAY = "2026-10-09";
