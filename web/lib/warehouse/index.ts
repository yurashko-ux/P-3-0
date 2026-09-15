/**
 * Нативний склад Kresco (етап 1 відмови від Altegio).
 *
 * Наступні етапи після складу (не в цьому релізі):
 * 2) довідник послуг + графік майстрів
 * 3) журнал запису
 * 4) каса / закриття візиту (тоді списання складу пишемо самі)
 * 5) рахунки клієнта (завдатки)
 * 6) фінансові документи в Kresco
 * 7) онлайн-запис
 * 8) вимкнення інтеграції Altegio
 */

export { requireWarehouseSection } from "./require-warehouse-auth";
export { importWarehouseFromAltegio } from "./import-from-altegio";
export { createWarehouseIntake } from "./documents";
export {
  getNativeWarehouseBalance,
  rebuildWarehouseStocksFromDocuments,
  applyPostedWarehouseDocument,
} from "./stock";
export type { NativeWarehouseBalance } from "./stock";
export type { WarehouseImportResult } from "./import-from-altegio";
