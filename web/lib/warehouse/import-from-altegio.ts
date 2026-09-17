// Bootstrap каталогу й залишків Altegio → нативні таблиці складу Kresco.

import { prisma } from "@/lib/prisma";
import { fetchWarehouseCatalogForImport } from "@/lib/altegio";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { rebuildWarehouseStocksFromDocuments, saveCurrentMonthStockSnapshot } from "./stock";
import { ensureGroupFromCategory } from "./catalog";
import { ensureKhvostyPair, resolveKrescoGroupTitle, KHVOSTY_GROUP_TITLE, deleteEmptySourceKrescoGroups, syncKhvostyGoodsToAltegio, moveKrescoProductsToKhvosty } from "./merge-khvosty";

export type WarehouseImportResult = {
  storages: number;
  products: number;
  hairProducts: number;
  snapshotLines: number;
  stockRows: number;
};

/** Ховаємо склади без додатного залишку — як «Склад #2638935», на якому немає товару. */
async function deactivateEmptyWarehouseStorages(): Promise<number> {
  const storages = await prisma.warehouseStorage.findMany({
    where: { isActive: true },
    include: { stocks: { select: { quantity: true } } },
  });
  let deactivated = 0;
  for (const storage of storages) {
    const hasStock = storage.stocks.some((row) => (Number(row.quantity) || 0) > 0);
    if (hasStock) continue;
    // Лише тех. порожні склади з Altegio («Склад #2638935»). Іменовані склади з Kresco лишаємо.
    if (!/^Склад #\d+$/.test(storage.title.trim())) continue;
    await prisma.warehouseStorage.update({
      where: { id: storage.id },
      data: { isActive: false },
    });
    deactivated += 1;
    console.log(
      `[warehouse/import] Вимкнено порожній склад «${storage.title}» (altegioStorageId=${storage.altegioStorageId ?? "—"})`,
    );
  }
  return deactivated;
}

const KRESCO_STORAGE_TITLES: Record<number, string> = {
  2343837: "Витратні матеріали",
  2343838: "Товари",
};

export async function importWarehouseFromAltegio(params?: {
  createdBy?: string | null;
}): Promise<WarehouseImportResult> {
  const merge = await ensureKhvostyPair();
  const snapshot = await fetchWarehouseCatalogForImport();
  const kyivDay = kyivCalendarTodayYmd();
  const now = new Date();

  console.log(
    `[warehouse/import] Старт імпорту: складів=${snapshot.storages.length}, товарів=${snapshot.goods.length}`,
  );

  const storageIdByAltegio = new Map<number, string>();
  for (const storage of snapshot.storages) {
    const existing = await prisma.warehouseStorage.findUnique({
      where: { altegioStorageId: storage.altegioStorageId },
    });
    const krescoTitle = KRESCO_STORAGE_TITLES[storage.altegioStorageId];
    const row = await prisma.warehouseStorage.upsert({
      where: { altegioStorageId: storage.altegioStorageId },
      create: {
        title: krescoTitle || storage.title,
        altegioStorageId: storage.altegioStorageId,
        includeInFinanceReport: storage.includeInFinanceReport,
        titleLocked: Boolean(krescoTitle),
        isActive: true,
      },
      update: {
        ...(krescoTitle
          ? { title: krescoTitle, titleLocked: true }
          : existing?.titleLocked
            ? {}
            : { title: storage.title }),
        includeInFinanceReport: storage.includeInFinanceReport,
        isActive: true,
      },
    });
    storageIdByAltegio.set(storage.altegioStorageId, row.id);
  }

  const groupByTitle = new Map<string, string>();
  for (const good of snapshot.goods) {
    const rawTitle = String(good.categoryTitle || "").trim();
    if (!rawTitle) continue;
    const title = resolveKrescoGroupTitle(rawTitle);
    if (!title) continue;
    if (groupByTitle.has(title)) continue;
    const group = await ensureGroupFromCategory({
      title,
      altegioCategoryId:
        title === KHVOSTY_GROUP_TITLE ? merge.targetAltegioCategoryId : good.categoryId,
      isHair: good.isHair || title === KHVOSTY_GROUP_TITLE,
    });
    if (group) groupByTitle.set(title, group.id);
  }

  const productIdByAltegio = new Map<number, string>();
  const chunkSize = 40;
  for (let i = 0; i < snapshot.goods.length; i += chunkSize) {
    const chunk = snapshot.goods.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (good) => {
        const mappedTitle = resolveKrescoGroupTitle(String(good.categoryTitle || "").trim());
        const groupId = (mappedTitle ? groupByTitle.get(mappedTitle) : null) || null;
        const isHair = good.isHair || mappedTitle === KHVOSTY_GROUP_TITLE;
        const row = await prisma.warehouseProduct.upsert({
          where: { altegioGoodId: good.altegioGoodId },
          create: {
            title: good.title,
            category: mappedTitle || good.categoryTitle || null,
            groupId,
            unit: good.unit,
            costPerUnit: good.costPerUnit,
            salePrice: good.salePrice,
            isHair,
            lengthCm: good.lengthCm,
            weightGrams: good.weightGrams,
            altegioGoodId: good.altegioGoodId,
            sku: good.altegioGoodId,
            isActive: true,
          },
          update: {
            title: good.title,
            category: mappedTitle || good.categoryTitle || null,
            groupId,
            unit: good.unit,
            costPerUnit: good.costPerUnit,
            salePrice: good.salePrice,
            isHair,
            lengthCm: good.lengthCm,
            weightGrams: good.weightGrams,
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
          comment: "Дзеркало залишків Altegio. Прийомки/списання з Kresco пишуться в Altegio окремими документами.",
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
  const deactivated = await deactivateEmptyWarehouseStorages();
  await moveKrescoProductsToKhvosty(merge.targetGroupId);
  const deletedEmptyGroups = await deleteEmptySourceKrescoGroups(merge.targetGroupId);
  try {
    await syncKhvostyGoodsToAltegio(merge.targetAltegioCategoryId, merge.targetGroupId);
  } catch (err) {
    console.warn(
      "[warehouse/import] Синхрон категорій у Altegio не завершився:",
      err instanceof Error ? err.message : err,
    );
  }
  const hairProducts = await prisma.warehouseProduct.count({ where: { isHair: true } });

  const result: WarehouseImportResult = {
    storages: snapshot.storages.length,
    products: snapshot.goods.length,
    hairProducts,
    snapshotLines: lines.filter((line) => line.quantity > 0).length,
    stockRows: rebuilt.stockRows,
  };

  console.log(
    `[warehouse/import] Імпорт завершено:`,
    result,
    `порожніх груп Kresco видалено=${deletedEmptyGroups.length}`,
    deactivated ? `складів вимкнено=${deactivated}` : "",
  );
  return result;
}
