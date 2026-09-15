/**
 * Нативний склад Kresco (етап 1 відмови від Altegio).
 *
 * Фаза «дзеркало»: залишки й каталог з Altegio. Прийомки поки в Altegio.
 * Далі: прийомка/списання/інвентаризація в Kresco з записом у Altegio.
 */

export { requireWarehouseSection } from "./require-warehouse-auth";
export { importWarehouseFromAltegio } from "./import-from-altegio";
export { createWarehouseIntake } from "./documents";
export {
  getNativeWarehouseBalance,
  rebuildWarehouseStocksFromDocuments,
  applyPostedWarehouseDocument,
  saveCurrentMonthStockSnapshot,
  getKyivYearMonth,
} from "./stock";
export type { NativeWarehouseBalance } from "./stock";
export type { WarehouseImportResult } from "./import-from-altegio";
