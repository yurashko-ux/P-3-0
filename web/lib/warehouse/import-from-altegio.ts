// Bootstrap каталогу й залишків Altegio → нативні таблиці складу Kresco.

import { prisma } from "@/lib/prisma";
import { fetchWarehouseCatalogForImport } from "@/lib/altegio";
import { kyivCalendarTodayYmd } from "@/lib/direct-kyiv-today";
import { rebuildWarehouseStocksFromDocuments, saveCurrentMonthStockSnapshot } from "./stock";
import { ensureGroupFromCategory } from "./catalog";
import {
  mergeHairTailsIntoKhvosty,
  resolveKrescoGroupTitle,
  KHVOSTY_GROUP_TITLE,
  deleteEmptySourceKrescoGroups,
  moveKrescoProductsToKhvosty,
} from "./merge-khvosty";

export type WarehouseImportResult = {
  storages: number;
  products: number;
  productsWritten: number;
  storagesWritten: number;
  hairProducts: number;
  snapshotLines: number;
  stockRows: number;
  /** true = залишки збіглись із поточним posted-знімком, документів не створювали */
  snapshotSkipped: boolean;
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

function roundQty(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function stockFingerprint(
  lines: Array<{ storageId: string; productId: string; quantity: number }>,
): string {
  return lines
    .filter((l) => roundQty(l.quantity) > 0)
    .map((l) => `${l.storageId}|${l.productId}|${roundQty(l.quantity)}`)
    .sort()
    .join("\n");
}

export async function importWarehouseFromAltegio(params?: {
  createdBy?: string | null;
}): Promise<WarehouseImportResult> {
  const khvosty = await mergeHairTailsIntoKhvosty();
  const snapshot = await fetchWarehouseCatalogForImport();
  const kyivDay = kyivCalendarTodayYmd();
  const now = new Date();

  console.log(
    `[warehouse/import] Старт імпорту: складів=${snapshot.storages.length}, товарів=${snapshot.goods.length}`,
  );

  // Один findMany замість findUnique+upsert на кожен склад
  const existingStorages = await prisma.warehouseStorage.findMany({
    where: {
      altegioStorageId: {
        in: snapshot.storages.map((s) => s.altegioStorageId),
      },
    },
  });
  const storageByAltegio = new Map(
    existingStorages
      .filter((s) => s.altegioStorageId != null)
      .map((s) => [s.altegioStorageId as number, s]),
  );

  // Склади лише в Kresco (напр. «Волосся»): однойменний склад Altegio не дзеркалимо окремо —
  // його залишки (якщо будуть) рахуємо на складі Kresco. Сам склад Kresco до Altegio не привʼязуємо.
  const krescoOnlyStorages = await prisma.warehouseStorage.findMany({
    where: { altegioStorageId: null, isActive: true },
    select: { id: true, title: true },
  });
  const krescoOnlyByTitle = new Map(
    krescoOnlyStorages.map((row) => [row.title.trim().toLocaleLowerCase("uk-UA"), row.id]),
  );

  const storageIdByAltegio = new Map<number, string>();
  let storagesWritten = 0;
  for (const storage of snapshot.storages) {
    const existing = storageByAltegio.get(storage.altegioStorageId);
    const krescoOnlyId = existing
      ? null
      : krescoOnlyByTitle.get(String(storage.title || "").trim().toLocaleLowerCase("uk-UA"));
    if (krescoOnlyId) {
      storageIdByAltegio.set(storage.altegioStorageId, krescoOnlyId);
      console.log(
        `[warehouse/import] Склад Altegio «${storage.title}» (${storage.altegioStorageId}) → склад лише в Kresco, без привʼязки`,
      );
      continue;
    }
    const krescoTitle = KRESCO_STORAGE_TITLES[storage.altegioStorageId];
    const nextTitle = krescoTitle
      ? krescoTitle
      : existing?.titleLocked
        ? existing.title
        : storage.title;
    const nextLocked = Boolean(krescoTitle) || Boolean(existing?.titleLocked);

    if (existing) {
      const same =
        existing.title === nextTitle &&
        existing.titleLocked === nextLocked &&
        existing.includeInFinanceReport === storage.includeInFinanceReport &&
        existing.isActive === true;
      if (same) {
        storageIdByAltegio.set(storage.altegioStorageId, existing.id);
        continue;
      }
      const row = await prisma.warehouseStorage.update({
        where: { id: existing.id },
        data: {
          title: nextTitle,
          titleLocked: nextLocked,
          includeInFinanceReport: storage.includeInFinanceReport,
          isActive: true,
        },
      });
      storageIdByAltegio.set(storage.altegioStorageId, row.id);
      storagesWritten += 1;
    } else {
      const row = await prisma.warehouseStorage.create({
        data: {
          title: nextTitle,
          altegioStorageId: storage.altegioStorageId,
          includeInFinanceReport: storage.includeInFinanceReport,
          titleLocked: Boolean(krescoTitle),
          isActive: true,
        },
      });
      storageIdByAltegio.set(storage.altegioStorageId, row.id);
      storagesWritten += 1;
    }
  }

  const groupByTitle = new Map<string, string>([[KHVOSTY_GROUP_TITLE, khvosty.targetGroupId]]);
  for (const good of snapshot.goods) {
    const rawTitle = String(good.categoryTitle || "").trim();
    if (!rawTitle) continue;
    const title = resolveKrescoGroupTitle(rawTitle);
    if (!title) continue;
    if (groupByTitle.has(title)) continue;
    const group = await ensureGroupFromCategory({
      title,
      altegioCategoryId: title === KHVOSTY_GROUP_TITLE ? null : good.categoryId,
      isHair: good.isHair || title === KHVOSTY_GROUP_TITLE,
    });
    if (group) groupByTitle.set(title, group.id);
  }

  const altegioGoodIds = snapshot.goods.map((g) => g.altegioGoodId);
  const existingProducts: Array<{
    id: string;
    altegioGoodId: number | null;
    title: string;
    category: string | null;
    groupId: string | null;
    unit: string | null;
    costPerUnit: number;
    salePrice: number;
    isHair: boolean;
    lengthCm: number | null;
    weightGrams: number | null;
    sku: number | null;
    isActive: boolean;
  }> = [];
  const PROD_CHUNK = 500;
  for (let i = 0; i < altegioGoodIds.length; i += PROD_CHUNK) {
    const chunk = altegioGoodIds.slice(i, i + PROD_CHUNK);
    const rows = await prisma.warehouseProduct.findMany({
      where: { altegioGoodId: { in: chunk } },
      select: {
        id: true,
        altegioGoodId: true,
        title: true,
        category: true,
        groupId: true,
        unit: true,
        costPerUnit: true,
        salePrice: true,
        isHair: true,
        lengthCm: true,
        weightGrams: true,
        sku: true,
        isActive: true,
      },
    });
    existingProducts.push(...rows);
  }
  const productByAltegio = new Map(
    existingProducts
      .filter((p) => p.altegioGoodId != null)
      .map((p) => [p.altegioGoodId as number, p]),
  );

  const productIdByAltegio = new Map<number, string>();
  let productsWritten = 0;
  const chunkSize = 40;
  for (let i = 0; i < snapshot.goods.length; i += chunkSize) {
    const chunk = snapshot.goods.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (good) => {
        const mappedTitle = resolveKrescoGroupTitle(String(good.categoryTitle || "").trim());
        const groupId = (mappedTitle ? groupByTitle.get(mappedTitle) : null) || null;
        const isHair = good.isHair || mappedTitle === KHVOSTY_GROUP_TITLE;
        const category = mappedTitle || good.categoryTitle || null;
        const existing = productByAltegio.get(good.altegioGoodId);

        if (existing) {
          const same =
            existing.title === good.title &&
            existing.category === category &&
            existing.groupId === groupId &&
            existing.unit === good.unit &&
            Number(existing.costPerUnit) === Number(good.costPerUnit) &&
            Number(existing.salePrice) === Number(good.salePrice) &&
            existing.isHair === isHair &&
            existing.lengthCm === good.lengthCm &&
            existing.weightGrams === good.weightGrams &&
            existing.sku === good.altegioGoodId &&
            existing.isActive === true;
          if (same) {
            productIdByAltegio.set(good.altegioGoodId, existing.id);
            return;
          }
          const row = await prisma.warehouseProduct.update({
            where: { id: existing.id },
            data: {
              title: good.title,
              category,
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
          productsWritten += 1;
          return;
        }

        const row = await prisma.warehouseProduct.create({
          data: {
            title: good.title,
            category,
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
        });
        productIdByAltegio.set(good.altegioGoodId, row.id);
        productsWritten += 1;
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

  // Групи з власним складом Kresco (Хвости, Накладки, Стрічки, Треси → «Волосся»):
  // їхні залишки з будь-якого складу Altegio кладемо на цей склад. В Altegio нічого не змінюється.
  const groupStorageRows = await prisma.warehouseProduct.findMany({
    where: { group: { storageId: { not: null } } },
    select: { id: true, group: { select: { storageId: true } } },
  });
  const groupStorageByProduct = new Map(
    groupStorageRows
      .filter((row) => row.group?.storageId)
      .map((row) => [row.id, row.group!.storageId as string]),
  );

  const lines: Array<{ productId: string; quantity: number; costPerUnit: number; storageId: string }> =
    [];
  for (const good of snapshot.goods) {
    const productId = productIdByAltegio.get(good.altegioGoodId);
    if (!productId) continue;
    const stocks =
      good.stocks.length > 0
        ? good.stocks
        : [{ altegioStorageId: 0, storageTitle: "Основний склад", quantity: 0 }];
    const groupStorageId = groupStorageByProduct.get(productId);
    for (const stock of stocks) {
      const storageId = groupStorageId || storageIdByAltegio.get(stock.altegioStorageId) || defaultStorageId;
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

  const nextFp = stockFingerprint(lines);

  // Порівняти з поточними posted-документами altegio_sync — якщо ті самі залишки, не чіпаємо
  const currentDocs = await prisma.warehouseDocument.findMany({
    where: { source: "altegio_import", type: "altegio_sync", status: "posted" },
    select: {
      toStorageId: true,
      lines: { select: { productId: true, quantity: true } },
    },
  });
  const currentLines: Array<{ storageId: string; productId: string; quantity: number }> = [];
  for (const doc of currentDocs) {
    if (!doc.toStorageId) continue;
    for (const line of doc.lines) {
      currentLines.push({
        storageId: doc.toStorageId,
        productId: line.productId,
        quantity: line.quantity,
      });
    }
  }
  const currentFp = stockFingerprint(currentLines);
  const snapshotSkipped = nextFp === currentFp && currentDocs.length > 0;

  let stockRows = 0;
  if (snapshotSkipped) {
    console.log(
      `[warehouse/import] Знімок пропущено: залишки без змін (рядків з qty>0=${lines.filter((l) => l.quantity > 0).length})`,
    );
    const stockCount = await prisma.warehouseStock.count();
    stockRows = stockCount;
  } else {
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
            comment:
              "Дзеркало залишків Altegio. Прийомки/списання з Kresco пишуться в Altegio окремими документами.",
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
    stockRows = rebuilt.stockRows;
    await saveCurrentMonthStockSnapshot();
  }

  const deactivated = await deactivateEmptyWarehouseStorages();
  await moveKrescoProductsToKhvosty(khvosty.targetGroupId);
  const deletedEmptyGroups = await deleteEmptySourceKrescoGroups(khvosty.targetGroupId);
  const hairProducts = await prisma.warehouseProduct.count({ where: { isHair: true } });

  const result: WarehouseImportResult = {
    storages: snapshot.storages.length,
    products: snapshot.goods.length,
    productsWritten,
    storagesWritten,
    hairProducts,
    snapshotLines: lines.filter((line) => line.quantity > 0).length,
    stockRows,
    snapshotSkipped,
  };

  console.log(
    `[warehouse/import] Імпорт завершено:`,
    result,
    `порожніх груп Kresco видалено=${deletedEmptyGroups.length}`,
    deactivated ? `складів вимкнено=${deactivated}` : "",
  );
  return result;
}
