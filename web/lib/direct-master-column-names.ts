// Імена майстрів у колонках Direct (для Telegram, сторінки консультацій тощо).

import type { DirectClient } from "@/lib/direct-types";
import {
  getConsultationMasterColumnNames,
  getRecordMasterColumnNames,
} from "@/lib/direct-master-column-display";

type MasterRef = { id: string; name: string };

/** @deprecated Використовуйте getConsultationMasterColumnNames або getRecordMasterColumnNames */
export function getMasterColumnNamesLikeTable(client: DirectClient, _masters: MasterRef[]): string[] {
  const consult = getConsultationMasterColumnNames(client);
  const record = getRecordMasterColumnNames(client);
  if (consult.length > 0) return consult;
  return record;
}

export { getConsultationMasterColumnNames, getRecordMasterColumnNames };
