export const FUND_BANK_NAME = 'АТ "Кредобанк"';
export const FUND_BANK_CODE = '325365';
export const FUND_RECIPIENT =
  'БЛАГОДІЙНА ОРГАНІЗАЦІЯ "БЛАГОДІЙНИЙ ФОНД "ВСІХ СВЯТИХ"';
export const FUND_EDRPOU = '45549417';
export const FUND_IBAN = 'UA053253650000000260090054870';

/** Текст для копіювання в месенджер або лист */
export function getFundRequisitesPlainText(): string {
  return [
    'Благодійний фонд «Всіх Святих» — реквізити для переказу',
    '',
    `Банк: ${FUND_BANK_NAME}`,
    `Код банку: ${FUND_BANK_CODE}`,
    `Отримувач: ${FUND_RECIPIENT}`,
    `Код ЄДРПОУ: ${FUND_EDRPOU}`,
    `IBAN: ${FUND_IBAN}`,
    '',
    'Призначення платежу: благодійний внесок (або зазначте мету збору за оголошенням фонду).',
  ].join('\n');
}
