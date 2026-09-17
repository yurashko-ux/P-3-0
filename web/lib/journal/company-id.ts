import { ALTEGIO_ENV } from "@/lib/altegio/env";

export function resolveJournalCompanyId(): number {
  const n = Number(process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID || 0);
  if (!(n > 0)) {
    throw new Error("ALTEGIO_COMPANY_ID не задано — журнал не може писати в Altegio");
  }
  return n;
}
