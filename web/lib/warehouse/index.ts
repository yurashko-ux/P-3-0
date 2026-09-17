/**
 * Нативний склад Kresco (етап 1 відмови від Altegio).
 *
 * Залишки = дзеркало Altegio. Прийомка / списання / інвентаризація ведуться в Kresco
 * і одразу пишуться в склад Altegio. Каса, журнал, банк — не чіпаємо.
 */

export { requireWarehouseSection } from "./require-warehouse-auth";
export { importWarehouseFromAltegio } from "./import-from-altegio";
export { createWarehouseIntake } from "./documents";
export {
  createHairIntake,
  createGoodsIntake,
  createWriteOff,
  createInventory,
  retryWarehouseDocumentSync,
  listWarehouseDocuments,
  getWarehouseDocument,
} from "./documents-kresco";
export {
  getNativeWarehouseBalance,
  rebuildWarehouseStocksFromDocuments,
  applyPostedWarehouseDocument,
  saveCurrentMonthStockSnapshot,
  getKyivYearMonth,
} from "./stock";
export type { NativeWarehouseBalance } from "./stock";
export type { WarehouseImportResult } from "./import-from-altegio";
export { createWarehouseStorage } from "./storages";
export { listSystemCurrencies, enableSystemCurrency, disableSystemCurrency } from "./currencies";
