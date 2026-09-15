// Bootstrap каталогу й залишків Altegio → нативні таблиці складу Kresco.

import { prisma } from "@/lib/prisma";
import { fetchWarehouseCatalogForImport } from "@/lib/altegio";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { rebuildWarehouseStocksFromDocuments, saveCurrentMonthStockSnapshot } from "./stock";

export type WarehouseImportResult = {
  storages: number;
  products: number;
  hairProducts: number;
  snapshotLines: number;
  stockRows: number;
};

export async function importWarehouseFromAltegio(params?: {
  createdBy?: string | null;
}): Promise<WarehouseImportResult> {
  const snapshot = await fetchWarehouseCatalogForImport();
  const kyivDay = kyivCalendarTodayYmd();
  const now = new Date();

  console.log(
    `[warehouse/import] Старт імпорту: складів=${snapshot.storages.length}, товарів=${snapshot.goods.length}`,
  );

  const storageIdByAltegio = new Map<number, string>();
  for (const storage of snapshot.storages) {
    const row = await prisma.warehouseStorage.upsert({
      where: { altegioStorageId: storage.altegioStorageId },
      create: {
        title: storage.title,
        altegioStorageId: storage.altegioStorageId,
        includeInFinanceReport: storage.includeInFinanceReport,
        isActive: true,
      },
      update: {
        title: storage.title,
        includeInFinanceReport: storage.includeInFinanceReport,
        isActive: true,
      },
    });
    storageIdByAltegio.set(storage.altegioStorageId, row.id);
  }

  const productIdByAltegio = new Map<number, string>();
  const chunkSize = 40;
  for (let i = 0; i < snapshot.goods.length; i += chunkSize) {
    const chunk = snapshot.goods.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (good) => {
        const row = await prisma.warehouseProduct.upsert({
          where: { altegioGoodId: good.altegioGoodId },
          create: {
            title: good.title,
            category: good.categoryTitle || null,
            unit: good.unit,
            costPerUnit: good.costPerUnit,
            salePrice: good.salePrice,
            isHair: good.isHair,
            lengthCm: good.lengthCm,
            altegioGoodId: good.altegioGoodId,
            sku: good.altegioGoodId,
            isActive: true,
          },
          update: {
            title: good.title,
            category: good.categoryTitle || null,
            unit: good.unit,
            costPerUnit: good.costPerUnit,
            salePrice: good.salePrice,
            isHair: good.isHair,
            lengthCm: good.lengthCm,
            sku: good.altegioGoodId,
            isActive: true,
          },
        });
        productIdByAltegio.set(good.altegioGoodId, row.id);
      }),
    );
  }

  const defaultStorageId =
    storageIdByAltegio.get(0) ||
    Array.from(storageIdByAltegio.values())[0] ||
    (
      await prisma.warehouseStorage.upsert({
        where: { altegioStorageId: 0 },
        create: {
          title: "Основний склад",
          altegioStorageId: 0,
          includeInFinanceReport: true,
        },
        update: { title: "Основний склад", isActive: true },
      })
    ).id;

  const lines: Array<{ productId: string; quantity: number; costPerUnit: number; storageId: string }> = [];
  for (const good of snapshot.goods) {
    const productId = productIdByAltegio.get(good.altegioGoodId);
    if (!productId) continue;
    const stocks = good.stocks.length > 0 ? good.stocks : [{ altegioStorageId: 0, storageTitle: "Основний склад", quantity: 0 }];
    for (const stock of stocks) {
      const storageId = storageIdByAltegio.get(stock.altegioStorageId) || defaultStorageId;
      lines.push({
        productId,
        quantity: stock.quantity,
        costPerUnit: good.costPerUnit,
        storageId,
      });
    }
  }

  // Один знімок на імпорт: рядки групуємо по складах, бо документ має один toStorageId.
  const linesByStorage = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByStorage.get(line.storageId) || [];
    list.push(line);
    linesByStorage.set(line.storageId, list);
  }

  await prisma.$transaction(async (tx) => {
    await tx.warehouseDocument.updateMany({
      where: { source: "altegio_import", type: "altegio_sync", status: "posted" },
      data: { status: "cancelled" },
    });

    for (const [storageId, storageLines] of linesByStorage.entries()) {
      const meaningful = storageLines.filter((line) => line.quantity > 0);
      if (meaningful.length === 0) continue;
      await tx.warehouseDocument.create({
        data: {
          type: "altegio_sync",
          status: "posted",
          occurredAt: now,
          kyivDay,
          toStorageId: storageId,
          comment: "Дзеркало залишків Altegio. Прийомки поки робіть в Altegio.",
          source: "altegio_import",
          createdBy: params?.createdBy || null,
          lines: {
            create: meaningful.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              costPerUnit: line.costPerUnit,
            })),
          },
        },
      });
    }
  });

  const rebuilt = await rebuildWarehouseStocksFromDocuments({ includeKrescoDocuments: false });
  await saveCurrentMonthStockSnapshot();
  const hairProducts = await prisma.warehouseProduct.count({ where: { isHair: true } });

  const result: WarehouseImportResult = {
    storages: snapshot.storages.length,
    products: snapshot.goods.length,
    hairProducts,
    snapshotLines: lines.filter((line) => line.quantity > 0).length,
    stockRows: rebuilt.stockRows,
  };

  console.log("[warehouse/import] Імпорт завершено:", result);
  return result;
}
