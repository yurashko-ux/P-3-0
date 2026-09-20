// Документи складу Kresco з записом у Altegio. Каса/журнал запису не чіпаємо.

import { prisma } from "@/lib/prisma";
import { kyivCalendarTodayYmd, kyivYmdFromDateTimeInput } from "@/lib/direct-kyiv-today";
import {
  ALTEGIO_STORAGE_OP,
  createAltegioGood,
  createAltegioStorageOperation,
  createAltegioStorageTransfer,
} from "@/lib/altegio/warehouse-write";
import { applyPostedWarehouseDocument } from "./stock";
import { requireUsdUahRate } from "./fx";
import { ensureGroupAltegioCategory } from "./catalog";
import { altegioCategoryIdForKrescoWrite } from "./merge-khvosty";
import { getEnabledCurrencyCodes } from "./currencies";

const HAIR_WEIGHT_TOLERANCE_G = 50;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function twoWordTitle(raw: string): string {
  const words = String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return words.join(" ");
}

function hairCardTitle(groupTitle: string, lengthCm: number, weightGrams: number): string {
  return `${groupTitle} ${lengthCm}см ${round2(weightGrams)}г`;
}

async function requireStorage(storageId: string) {
  const storage = await prisma.warehouseStorage.findUnique({ where: { id: storageId } });
  if (!storage) throw new Error("Склад не знайдено");
  if (!(storage.altegioStorageId && storage.altegioStorageId > 0)) {
    throw new Error("У цього складу немає id Altegio. Натисніть «Оновити з Altegio» на залишках.");
  }
  return storage;
}

async function convertToUah(params: {
  amount: number;
  currencyCode: string;
  fxRateUsdUah: number | null;
}): Promise<{ amountUah: number; fxRateUsdUah: number | null }> {
  const code = params.currencyCode.toUpperCase();
  const amount = Number(params.amount) || 0;
  if (code === "UAH") return { amountUah: amount, fxRateUsdUah: params.fxRateUsdUah };
  if (code === "USD") {
    const rate = params.fxRateUsdUah && params.fxRateUsdUah > 0 ? params.fxRateUsdUah : (await requireUsdUahRate()).rate;
    return { amountUah: round2(amount * rate), fxRateUsdUah: rate };
  }
  throw new Error(
    `Валюта ${code} увімкнена, але для запису в Altegio потрібен курс у гривню. Зараз у фінзвіті є лише USD. Проведіть документ у UAH або USD.`,
  );
}

async function postOperationAndApply(params: {
  documentId: string;
  typeId: number;
  storageAltegioId: number;
  comment: string;
  occurredAt: Date;
  lines: Array<{ altegioGoodId: number; amount: number; costUah: number }>;
}) {
  try {
    const op = await createAltegioStorageOperation({
      typeId: params.typeId,
      storageId: params.storageAltegioId,
      date: params.occurredAt,
      comment: params.comment,
      lines: params.lines.map((line) => ({
        goodId: line.altegioGoodId,
        amount: line.amount,
        costUah: line.costUah,
      })),
    });
    await prisma.warehouseDocument.update({
      where: { id: params.documentId },
      data: {
        status: "posted",
        syncStatus: "synced",
        syncError: null,
        altegioTxId: op.id,
      },
    });
    if (params.typeId !== 0) {
      await applyPostedWarehouseDocument(params.documentId);
    }
    console.log(`[warehouse/docs] Документ ${params.documentId} синхронізовано в Altegio id=${op.id}`);
    return op.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.warehouseDocument.update({
      where: { id: params.documentId },
      data: { status: "sync_error", syncStatus: "error", syncError: message },
    });
    console.error(`[warehouse/docs] Помилка dual-write ${params.documentId}:`, message);
    throw new Error(message);
  }
}

export async function retryWarehouseDocumentSync(documentId: string) {
  const doc = await prisma.warehouseDocument.findUnique({
    where: { id: documentId },
    include: { lines: { include: { product: true } }, toStorage: true, fromStorage: true },
  });
  if (!doc) throw new Error("Документ не знайдено");
  if (doc.altegioTxId && doc.syncStatus === "synced") return doc;
  if (doc.source !== "kresco") throw new Error("Імпортовані з Altegio документи повторно не відправляємо");

  if (doc.type === "inventory_count") {
    throw new Error("Інвентаризацію в Altegio не відправляємо — лише автоприйомку та автосписання");
  }

  const missing = doc.lines.filter((line) => !(line.product.altegioGoodId && line.product.altegioGoodId > 0));
  if (missing.length > 0) {
    throw new Error("У рядках немає id товару Altegio — картки не створились");
  }

  const lines = doc.lines.map((line) => ({
    altegioGoodId: line.product.altegioGoodId as number,
    amount: line.quantity,
    costUah: (Number(line.costPerUnit) || 0) * (Number(line.quantity) || 0),
  }));

  if (doc.type === "transfer") {
    if (!doc.fromStorage?.altegioStorageId || !doc.toStorage?.altegioStorageId) {
      throw new Error("Немає складів Altegio для переміщення");
    }
    try {
      const op = await createAltegioStorageTransfer({
        fromStorageId: doc.fromStorage.altegioStorageId,
        toStorageId: doc.toStorage.altegioStorageId,
        date: doc.occurredAt,
        comment: doc.comment || doc.title || "Переміщення складу",
        lines: lines.map((line) => ({
          goodId: line.altegioGoodId,
          amount: line.amount,
          costUah: line.costUah,
        })),
      });
      await prisma.warehouseDocument.update({
        where: { id: doc.id },
        data: { status: "posted", syncStatus: "synced", syncError: null, altegioTxId: op.id },
      });
      await applyPostedWarehouseDocument(doc.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.warehouseDocument.update({
        where: { id: doc.id },
        data: { status: "sync_error", syncStatus: "error", syncError: message },
      });
      throw new Error(message);
    }
    return prisma.warehouseDocument.findUnique({
      where: { id: documentId },
      include: { lines: { include: { product: true } }, toStorage: true, fromStorage: true, children: true },
    });
  }

  const storage = doc.type === "write_off" ? doc.fromStorage : doc.toStorage;
  if (!storage?.altegioStorageId) throw new Error("Немає складу Altegio");
  const typeId = doc.type === "write_off" ? ALTEGIO_STORAGE_OP.writeOff : ALTEGIO_STORAGE_OP.receipt;

  await postOperationAndApply({
    documentId: doc.id,
    typeId,
    storageAltegioId: storage.altegioStorageId,
    comment: doc.comment || doc.title || "Kresco",
    occurredAt: doc.occurredAt,
    lines,
  });
  return prisma.warehouseDocument.findUnique({
    where: { id: documentId },
    include: { lines: { include: { product: true } }, toStorage: true, fromStorage: true, children: true },
  });
}

export async function createHairIntake(input: {
  storageId: string;
  groupId: string;
  title: string;
  weightKg: number;
  invoiceAmountUsd: number;
  deliveryAmountUsd?: number;
  occurredAt?: string;
  createdBy?: string | null;
  lines: Array<{ lengthCm: number; weightGrams: number }>;
}) {
  const storage = await requireStorage(input.storageId);
  const group = await ensureGroupAltegioCategory(input.groupId);
  const altegioCategoryId = await altegioCategoryIdForKrescoWrite(group);

  const title = twoWordTitle(input.title);
  if (!title) throw new Error("Назва прийомки — два слова");

  const kg = Number(input.weightKg) || 0;
  const invoiceUsd = Number(input.invoiceAmountUsd) || 0;
  const deliveryUsd = Number(input.deliveryAmountUsd) || 0;
  if (!(kg > 0)) throw new Error("Вкажіть вагу накладної в кілограмах");
  if (!(invoiceUsd > 0)) throw new Error("Вкажіть вартість накладної в доларах");

  const fx = await requireUsdUahRate();
  const invoiceGrams = round2(kg * 1000);
  const costPerGramUsd = (invoiceUsd + deliveryUsd) / invoiceGrams;

  const rawLines = (input.lines || [])
    .map((line) => ({
      lengthCm: Math.round(Number(line.lengthCm) || 0),
      weightGrams: Number(line.weightGrams) || 0,
    }))
    .filter((line) => line.weightGrams > 0);
  if (rawLines.length === 0) throw new Error("Додайте хоча б один хвіст із вагою в грамах");

  for (const line of rawLines) {
    if (!(line.lengthCm > 0)) throw new Error("У кожного зрізу має бути довжина в см");
  }

  const sumGrams = round2(rawLines.reduce((acc, line) => acc + line.weightGrams, 0));
  const delta = round2(sumGrams - invoiceGrams);
  const mismatch = Math.abs(delta) > HAIR_WEIGHT_TOLERANCE_G;

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const kyivDay = kyivYmdFromDateTimeInput(occurredAt) || kyivCalendarTodayYmd();

  const createdProducts: Array<{
    productId: string;
    altegioGoodId: number;
    weightGrams: number;
    costUsd: number;
    costUah: number;
  }> = [];

  for (const line of rawLines) {
    const costUsd = round2(costPerGramUsd * line.weightGrams);
    const costUah = round2(costUsd * fx.rate);
    const cardTitle = hairCardTitle(group.title, line.lengthCm, line.weightGrams);
    const altegio = await createAltegioGood({
      title: cardTitle,
      categoryId: altegioCategoryId,
      unit: "шт",
      costUah,
      comment: `Kresco hair ${title}; ${line.weightGrams}г; ${costUsd}$`,
    });
    const product = await prisma.warehouseProduct.create({
      data: {
        sku: altegio.id,
        title: cardTitle,
        category: group.title,
        groupId: group.id,
        unit: "шт",
        costPerUnit: costUah,
        costUsd,
        isHair: true,
        lengthCm: line.lengthCm,
        weightGrams: line.weightGrams,
        altegioGoodId: altegio.id,
        isActive: true,
      },
    });
    createdProducts.push({
      productId: product.id,
      altegioGoodId: altegio.id,
      weightGrams: line.weightGrams,
      costUsd,
      costUah,
    });
  }

  const document = await prisma.warehouseDocument.create({
    data: {
      type: "intake",
      status: "pending",
      kind: "hair",
      title,
      currencyCode: "USD",
      invoiceAmount: invoiceUsd,
      deliveryAmount: deliveryUsd,
      invoiceWeightGrams: invoiceGrams,
      weightDeltaGrams: delta,
      fxRateUsdUah: fx.rate,
      weightMismatch: mismatch,
      syncStatus: "pending",
      occurredAt,
      kyivDay,
      toStorageId: storage.id,
      comment: `Прийомка волосся ${kg} кг / ${invoiceUsd}$${deliveryUsd ? ` + доставка ${deliveryUsd}$` : ""}`,
      source: "kresco",
      createdBy: input.createdBy || null,
      lines: {
        create: createdProducts.map((line) => ({
          productId: line.productId,
          quantity: 1,
          costPerUnit: line.costUah,
          weightGrams: line.weightGrams,
          costUsd: line.costUsd,
          costInDocumentCurrency: line.costUsd,
        })),
      },
    },
  });

  await postOperationAndApply({
    documentId: document.id,
    typeId: ALTEGIO_STORAGE_OP.receipt,
    storageAltegioId: storage.altegioStorageId as number,
    comment: document.comment || title,
    occurredAt,
    lines: createdProducts.map((line) => ({
      altegioGoodId: line.altegioGoodId,
      amount: 1,
      costUah: line.costUah,
    })),
  });

  return prisma.warehouseDocument.findUniqueOrThrow({
    where: { id: document.id },
    include: {
      lines: { include: { product: { include: { group: true } } } },
      toStorage: true,
    },
  });
}

export async function createGoodsIntake(input: {
  storageId: string;
  title: string;
  currencyCode: string;
  invoiceAmount: number;
  deliveryAmount?: number;
  occurredAt?: string;
  createdBy?: string | null;
  lines: Array<{
    productId?: string;
    title?: string;
    groupId?: string;
    quantity: number;
    price: number;
    /** Валюта рядка (собівартість); якщо немає — currencyCode документа */
    currencyCode?: string;
  }>;
}) {
  const storage = await requireStorage(input.storageId);
  const title = twoWordTitle(input.title);
  if (!title) throw new Error("Назва прийомки — два слова");

  const enabled = await getEnabledCurrencyCodes();
  const docCurrencyFallback = String(input.currencyCode || "UAH").toUpperCase();

  const invoiceAmount = Number(input.invoiceAmount) || 0;
  const deliveryAmount = Number(input.deliveryAmount) || 0;
  if (!(invoiceAmount > 0)) throw new Error("Вкажіть суму накладної (без доставки)");

  const rawLines = (input.lines || [])
    .map((line) => {
      const lineCur = String(line.currencyCode || docCurrencyFallback || "UAH").toUpperCase();
      return {
        productId: String(line.productId || "").trim(),
        title: String(line.title || "").trim(),
        groupId: String(line.groupId || "").trim(),
        quantity: Number(line.quantity) || 0,
        price: Number(line.price) || 0,
        currencyCode: lineCur,
      };
    })
    .filter((line) => line.quantity > 0 && line.price > 0 && (line.productId || line.title));
  if (rawLines.length === 0) throw new Error("Додайте рядки: кількість і ціна закупки");

  for (const line of rawLines) {
    if (!enabled.includes(line.currencyCode)) {
      throw new Error(`Валюта ${line.currencyCode} не увімкнена. Увімкніть її в розділі Валюти.`);
    }
  }

  // Доставка пропорційно сумі рядків у їхніх валютах (якщо мікс — частка по номіналу).
  const linesSum = rawLines.reduce((acc, line) => acc + line.quantity * line.price, 0);
  const deliveryShare = linesSum > 0 ? deliveryAmount / linesSum : 0;

  let sharedFx: number | null = null;
  const needsUsd = rawLines.some((l) => l.currencyCode === "USD");
  if (needsUsd) {
    sharedFx = (await requireUsdUahRate()).rate;
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const kyivDay = kyivYmdFromDateTimeInput(occurredAt) || kyivCalendarTodayYmd();

  const prepared: Array<{
    productId: string;
    altegioGoodId: number;
    quantity: number;
    costDoc: number;
    costUah: number;
    currencyCode: string;
  }> = [];

  for (const line of rawLines) {
    const currency = line.currencyCode;
    const unitDoc = round4(line.price + line.price * deliveryShare);
    const converted = await convertToUah({
      amount: unitDoc,
      currencyCode: currency,
      fxRateUsdUah: sharedFx,
    });
    let product = line.productId
      ? await prisma.warehouseProduct.findUnique({ where: { id: line.productId }, include: { group: true } })
      : null;
    if (!product) {
      if (!line.groupId) throw new Error(`Для нового товару «${line.title}» оберіть групу`);
      const group = await ensureGroupAltegioCategory(line.groupId);
      const categoryId = await altegioCategoryIdForKrescoWrite(group);
      const altegio = await createAltegioGood({
        title: line.title,
        categoryId,
        costUah: converted.amountUah,
        comment: `Kresco goods ${title}`,
      });
      product = await prisma.warehouseProduct.create({
        data: {
          sku: altegio.id,
          title: line.title,
          category: group.title,
          groupId: group.id,
          unit: "шт",
          costPerUnit: converted.amountUah,
          costUsd: currency === "USD" ? unitDoc : 0,
          isHair: group.isHair,
          altegioGoodId: altegio.id,
          isActive: true,
        },
        include: { group: true },
      });
    } else if (!product.altegioGoodId) {
      throw new Error(`Товар «${product.title}» без id Altegio. Оновіть дзеркало складу.`);
    } else {
      await prisma.warehouseProduct.update({
        where: { id: product.id },
        data: {
          costPerUnit: converted.amountUah,
          ...(currency === "USD" ? { costUsd: unitDoc } : {}),
        },
      });
    }
    prepared.push({
      productId: product.id,
      altegioGoodId: product.altegioGoodId as number,
      quantity: line.quantity,
      costDoc: unitDoc,
      costUah: converted.amountUah,
      currencyCode: currency,
    });
    if (converted.fxRateUsdUah) sharedFx = converted.fxRateUsdUah;
  }

  const currencyCounts = new Map<string, number>();
  for (const line of prepared) {
    currencyCounts.set(line.currencyCode, (currencyCounts.get(line.currencyCode) || 0) + 1);
  }
  let currency = docCurrencyFallback;
  let best = 0;
  for (const [code, n] of currencyCounts) {
    if (n > best) {
      best = n;
      currency = code;
    }
  }

  const document = await prisma.warehouseDocument.create({
    data: {
      type: "intake",
      status: "pending",
      kind: "goods",
      title,
      currencyCode: currency,
      invoiceAmount,
      deliveryAmount,
      fxRateUsdUah: sharedFx,
      syncStatus: "pending",
      occurredAt,
      kyivDay,
      toStorageId: storage.id,
      comment: `Прийомка товару ${invoiceAmount} ${currency}${deliveryAmount ? ` + доставка ${deliveryAmount}` : ""}`,
      source: "kresco",
      createdBy: input.createdBy || null,
      lines: {
        create: prepared.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          costPerUnit: line.costUah,
          costUsd: line.currencyCode === "USD" ? line.costDoc : 0,
          costInDocumentCurrency: line.costDoc,
        })),
      },
    },
  });

  await postOperationAndApply({
    documentId: document.id,
    typeId: ALTEGIO_STORAGE_OP.receipt,
    storageAltegioId: storage.altegioStorageId as number,
    comment: document.comment || title,
    occurredAt,
    lines: prepared.map((line) => ({
      altegioGoodId: line.altegioGoodId,
      amount: line.quantity,
      costUah: round2(line.costUah * line.quantity),
    })),
  });

  return prisma.warehouseDocument.findUniqueOrThrow({
    where: { id: document.id },
    include: { lines: { include: { product: true } }, toStorage: true },
  });
}

export async function createWriteOff(input: {
  storageId: string;
  title: string;
  occurredAt?: string;
  createdBy?: string | null;
  parentDocumentId?: string;
  lines: Array<{ productId: string; quantity: number }>;
}) {
  const storage = await requireStorage(input.storageId);
  const title = twoWordTitle(input.title) || "Списання";
  const rawLines = (input.lines || [])
    .map((line) => ({ productId: String(line.productId || ""), quantity: Number(line.quantity) || 0 }))
    .filter((line) => line.productId && line.quantity > 0);
  if (rawLines.length === 0) throw new Error("Додайте товар і кількість для списання");

  const products = await prisma.warehouseProduct.findMany({
    where: { id: { in: rawLines.map((line) => line.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const line of rawLines) {
    const product = byId.get(line.productId);
    if (!product) throw new Error("Товар для списання не знайдено");
    if (!(product.altegioGoodId && product.altegioGoodId > 0)) {
      throw new Error(`«${product.title}» без id Altegio`);
    }
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const kyivDay = kyivYmdFromDateTimeInput(occurredAt) || kyivCalendarTodayYmd();
  const document = await prisma.warehouseDocument.create({
    data: {
      type: "write_off",
      status: "pending",
      kind: "goods",
      title,
      currencyCode: "UAH",
      syncStatus: "pending",
      occurredAt,
      kyivDay,
      fromStorageId: storage.id,
      parentDocumentId: input.parentDocumentId || null,
      comment: `Списання: ${title}`,
      source: "kresco",
      createdBy: input.createdBy || null,
      lines: {
        create: rawLines.map((line) => {
          const product = byId.get(line.productId)!;
          return {
            productId: line.productId,
            quantity: line.quantity,
            costPerUnit: product.costPerUnit,
            costUsd: product.costUsd,
            costInDocumentCurrency: product.costPerUnit,
          };
        }),
      },
    },
  });

  await postOperationAndApply({
    documentId: document.id,
    typeId: ALTEGIO_STORAGE_OP.writeOff,
    storageAltegioId: storage.altegioStorageId as number,
    comment: document.comment || title,
    occurredAt,
    lines: rawLines.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        altegioGoodId: product.altegioGoodId as number,
        amount: line.quantity,
        costUah: round2(product.costPerUnit * line.quantity),
      };
    }),
  });

  return prisma.warehouseDocument.findUniqueOrThrow({
    where: { id: document.id },
    include: { lines: { include: { product: true } }, fromStorage: true },
  });
}

export async function createStorageTransfer(input: {
  fromStorageId: string;
  toStorageId: string;
  createdBy?: string | null;
  lines: Array<{ productId: string; quantity: number }>;
}) {
  if (!input.fromStorageId || !input.toStorageId) {
    throw new Error("Оберіть склад звідки і склад куди");
  }
  if (input.fromStorageId === input.toStorageId) {
    throw new Error("Склади звідки і куди мають бути різні");
  }
  const from = await requireStorage(input.fromStorageId);
  const to = await requireStorage(input.toStorageId);

  const merged = new Map<string, number>();
  for (const line of input.lines || []) {
    const productId = String(line.productId || "").trim();
    const quantity = Number(line.quantity) || 0;
    if (!productId || quantity <= 0) continue;
    merged.set(productId, round4((merged.get(productId) || 0) + quantity));
  }
  const rawLines = [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  if (rawLines.length === 0) throw new Error("Додайте коди товарів для переміщення");

  const products = await prisma.warehouseProduct.findMany({
    where: { id: { in: rawLines.map((line) => line.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const line of rawLines) {
    const product = byId.get(line.productId);
    if (!product) throw new Error("Товар для переміщення не знайдено");
    if (!(product.altegioGoodId && product.altegioGoodId > 0)) {
      throw new Error(`«${product.title}» без id Altegio`);
    }
    const stock = await prisma.warehouseStock.findUnique({
      where: { productId_storageId: { productId: line.productId, storageId: from.id } },
    });
    const have = Number(stock?.quantity) || 0;
    if (have + 1e-9 < line.quantity) {
      throw new Error(
        `«${product.title}»: на складі «${from.title}» лише ${have}, треба ${line.quantity}`,
      );
    }
  }

  const occurredAt = new Date();
  const kyivDay = kyivCalendarTodayYmd();
  const comment = `Переміщення зі складу «${from.title}» на «${to.title}»`;
  const document = await prisma.warehouseDocument.create({
    data: {
      type: "transfer",
      status: "pending",
      kind: "goods",
      title: "Переміщення складу",
      currencyCode: "UAH",
      syncStatus: "pending",
      occurredAt,
      kyivDay,
      fromStorageId: from.id,
      toStorageId: to.id,
      comment,
      source: "kresco",
      createdBy: input.createdBy || null,
      lines: {
        create: rawLines.map((line) => {
          const product = byId.get(line.productId)!;
          return {
            productId: line.productId,
            quantity: line.quantity,
            costPerUnit: product.costPerUnit,
            costUsd: product.costUsd,
            costInDocumentCurrency: product.costPerUnit,
          };
        }),
      },
    },
  });

  try {
    const op = await createAltegioStorageTransfer({
      fromStorageId: from.altegioStorageId as number,
      toStorageId: to.altegioStorageId as number,
      date: occurredAt,
      comment,
      lines: rawLines.map((line) => {
        const product = byId.get(line.productId)!;
        return {
          goodId: product.altegioGoodId as number,
          amount: line.quantity,
          costUah: round2((Number(product.costPerUnit) || 0) * line.quantity),
        };
      }),
    });
    await prisma.warehouseDocument.update({
      where: { id: document.id },
      data: { status: "posted", syncStatus: "synced", syncError: null, altegioTxId: op.id },
    });
    await applyPostedWarehouseDocument(document.id);
    console.log(
      `[warehouse/docs] Переміщення ${rawLines.length} позицій: «${from.title}» → «${to.title}» doc=${document.id} altegio=${op.id}`,
    );
    return prisma.warehouseDocument.findUniqueOrThrow({
      where: { id: document.id },
      include: { lines: { include: { product: true } }, fromStorage: true, toStorage: true },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.warehouseDocument.update({
      where: { id: document.id },
      data: { status: "sync_error", syncStatus: "error", syncError: message },
    });
    console.error(`[warehouse/docs] Переміщення ${document.id} не пройшло в Altegio:`, message);
    throw new Error(message);
  }
}

export async function createInventory(input: {
  storageId: string;
  title: string;
  occurredAt?: string;
  createdBy?: string | null;
  lines: Array<{ productId: string; countedQty: number }>;
}) {
  const storage = await requireStorage(input.storageId);
  const title = twoWordTitle(input.title) || "Інвентаризація";
  const rawLines = (input.lines || [])
    .map((line) => ({
      productId: String(line.productId || ""),
      countedQty: Number(line.countedQty),
    }))
    .filter((line) => line.productId && Number.isFinite(line.countedQty) && line.countedQty >= 0);
  if (rawLines.length === 0) throw new Error("Додайте фактичні залишки по товарах");

  const products = await prisma.warehouseProduct.findMany({
    where: { id: { in: rawLines.map((line) => line.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const stocks = await prisma.warehouseStock.findMany({
    where: { storageId: storage.id, productId: { in: rawLines.map((line) => line.productId) } },
  });
  const qtyByProduct = new Map(stocks.map((row) => [row.productId, Number(row.quantity) || 0]));

  const surplus: Array<{ productId: string; quantity: number; costPerUnit: number }> = [];
  const shortage: Array<{ productId: string; quantity: number }> = [];
  for (const line of rawLines) {
    const product = byId.get(line.productId);
    if (!product) throw new Error("Товар інвентаризації не знайдено");
    const book = qtyByProduct.get(line.productId) || 0;
    const diff = round4(line.countedQty - book);
    if (diff > 0.0001) {
      surplus.push({ productId: line.productId, quantity: diff, costPerUnit: product.costPerUnit });
    } else if (diff < -0.0001) {
      shortage.push({ productId: line.productId, quantity: Math.abs(diff) });
    }
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const kyivDay = kyivYmdFromDateTimeInput(occurredAt) || kyivCalendarTodayYmd();

  const inventory = await prisma.warehouseDocument.create({
    data: {
      type: "inventory_count",
      status: "posted",
      kind: "goods",
      title,
      currencyCode: "UAH",
      syncStatus: "synced",
      occurredAt,
      kyivDay,
      toStorageId: storage.id,
      comment: `Інвентаризація: ${title}. Надлишок рядків=${surplus.length}, недостача=${shortage.length}`,
      source: "kresco",
      createdBy: input.createdBy || null,
      lines: {
        create: rawLines.map((line) => {
          const product = byId.get(line.productId)!;
          const book = qtyByProduct.get(line.productId) || 0;
          return {
            productId: line.productId,
            quantity: book,
            countedQty: line.countedQty,
            costPerUnit: product.costPerUnit,
            comment: `облік ${book} → факт ${line.countedQty}`,
          };
        }),
      },
    },
    include: { lines: { include: { product: true } }, toStorage: true },
  });

  let intake = null;
  let writeOff = null;
  if (surplus.length > 0) {
    intake = await createGoodsIntake({
      storageId: storage.id,
      title: "Надлишок інв",
      currencyCode: "UAH",
      invoiceAmount: surplus.reduce((acc, row) => acc + row.quantity * row.costPerUnit, 0) || 0.01,
      createdBy: input.createdBy,
      lines: surplus.map((row) => ({
        productId: row.productId,
        quantity: row.quantity,
        price: row.costPerUnit || 0.01,
      })),
    });
    await prisma.warehouseDocument.update({
      where: { id: intake.id },
      data: { parentDocumentId: inventory.id, title: twoWordTitle(`Надлишок ${title}`) || "Надлишок" },
    });
  }
  if (shortage.length > 0) {
    writeOff = await createWriteOff({
      storageId: storage.id,
      title: `Нестача ${title}`,
      createdBy: input.createdBy,
      parentDocumentId: inventory.id,
      lines: shortage,
    });
  }

  console.log(
    `[warehouse/docs] Інвентаризація ${inventory.id}: надлишок=${surplus.length}, недостача=${shortage.length}`,
  );
  return {
    inventory,
    intake,
    writeOff,
  };
}

export async function listWarehouseDocuments(params: { q?: string; type?: string }) {
  const q = String(params.q || "").trim();
  const type = String(params.type || "").trim();
  return prisma.warehouseDocument.findMany({
    where: {
      source: "kresco",
      type: type ? type : { in: ["intake", "write_off", "inventory_count", "transfer"] },
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { comment: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      toStorage: true,
      fromStorage: true,
      lines: { include: { product: true } },
      children: { select: { id: true, type: true, title: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 300,
  });
}

export async function getWarehouseDocument(id: string) {
  return prisma.warehouseDocument.findUnique({
    where: { id },
    include: {
      toStorage: true,
      fromStorage: true,
      lines: { include: { product: { include: { group: true } } } },
      children: { include: { lines: { include: { product: true } } } },
      parent: { select: { id: true, type: true, title: true } },
    },
  });
}
