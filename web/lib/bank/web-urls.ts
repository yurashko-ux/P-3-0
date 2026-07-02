import { kyivDayFromISO } from "@/lib/altegio/records-grouping";

/** Календарний день операції monobank у Europe/Kyiv. */
export function kyivDayFromBankOperationTime(operationTime: string): string {
  return kyivDayFromISO(operationTime);
}

/** Відкрити конкретну банківську операцію в розділі «Банк». */
export function buildBankStatementItemUrl(
  bankStatementItemId: string,
  operationTime: string,
): string {
  const day = kyivDayFromBankOperationTime(operationTime);
  const params = new URLSearchParams({
    item: bankStatementItemId,
    from: day,
    to: day,
  });
  return `/admin/bank?${params.toString()}`;
}
