// Документи складу Kresco з записом у Altegio. Каса/журнал запису не чіпаємо.

import { prisma } from "@/lib/prisma";
import { kyivCalendarTodayYmd, kyivYmdFromDateTimeInput } from "@/lib/direct-kyiv-today";
import {
  ALTEGIO_STORAGE_OP,
  createAltegioGood,
  createAltegioStorageOperation,
  createAltegioStorageTransfer,
  deleteAltegioStorageDocument,
  updateAltegioGoodSalePrice,
} from "@/lib/altegio/warehouse-write";
import { applyPostedWarehouseDocument } from "./stock";
import { requireUsdUahRate } from "./fx";
import { ensureGroupAltegioCategory } from "./catalog";
import { altegioCategoryIdForKrescoWrite } from "./merge-khvosty";
import { getEnabledCurrencyCodes } from "./currencies";
import { altegioStorageIdForWrites, isKrescoOnlyStorage } from "./storages";

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

/**
 * Склад для документа. altegioStorageId у відповіді — склад Altegio, куди пишемо операцію:
 * для складу лише в Kresco («Волосся») це altegioWriteStorageId («Товари»).
 * krescoOnly — ознака складу без власного складу Altegio.
 */
async function requireStorage(storageId: string) {
  const storage = await prisma.warehouseStorage.findUnique({ where: { id: storageId } });
  if (!storage) throw new Error("Склад не знайдено");
  const altegioStorageId = altegioStorageIdForWrites(storage);
  if (!altegioStorageId) {
    throw new Error("У цього складу немає id Altegio. Натисніть «Оновити з Altegio» на залишках.");
  }
  return { ...storage, altegioStorageId, krescoOnly: isKrescoOnlyStorage(storage) };
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

function hairGoodComment(title: string, weightGrams: number, costUsd: number): string {
  return `Kresco hair ${title}; ${weightGrams}г; ${costUsd}$`;
}

/** Документ, який ще можна провести: чернетка, помилка Altegio або завислий запис (старший 5 хв). */
const POSTING_STALE_MS = 5 * 60 * 1000;

/**
 * Картки прийомки, створені в чернетці лише в Kresco: створюємо їх в Altegio і вмикаємо.
 * Наявним товарам прийомки ставимо собівартість з рядка (у чернетці її не міняли).
 */
async function prepareIntakeProductsForPosting(doc: {
  id: string;
  kind: string | null;
  title: string | null;
  currencyCode: string | null;
  lines: Array<{
    quantity: number;
    costPerUnit: number;
    costUsd: number | null;
    costInDocumentCurrency: number | null;
    weightGrams: number | null;
    product: {
      id: string;
      title: string;
      groupId: string | null;
      altegioGoodId: number | null;
      isActive: boolean;
      salePrice: number;
    };
  }>;
}) {
  for (const line of doc.lines) {
    const product = line.product;
    if (product.altegioGoodId && product.altegioGoodId > 0) {
      if (doc.kind === "goods") {
        await prisma.warehouseProduct.update({
          where: { id: product.id },
          data: {
            costPerUnit: line.costPerUnit,
            ...(doc.currencyCode === "USD" && line.costUsd ? { costUsd: line.costUsd } : {}),
          },
        });
        // Ціну продажу з чернетки переносимо в Altegio (якщо там інша)
        if (product.salePrice > 0) await updateAltegioGoodSalePrice(product.altegioGoodId, product.salePrice);
      }
      continue;
    }
    if (!product.groupId) throw new Error(`У товару «${product.title}» немає групи — не можу створити картку в Altegio`);
    const group = await ensureGroupAltegioCategory(product.groupId);
    const categoryId = await altegioCategoryIdForKrescoWrite(group);
    const altegio = await createAltegioGood({
      title: product.title,
      categoryId,
      unit: "шт",
      costUah: line.costPerUnit,
      salePriceUah: product.salePrice,
      ...(doc.kind === "hair" ? { article: product.title } : {}),
      comment:
        doc.kind === "hair"
          ? hairGoodComment(doc.title || "", line.weightGrams || 0, line.costUsd || 0)
          : `Kresco goods ${doc.title || ""}`,
    });
    await prisma.warehouseProduct.update({
      where: { id: product.id },
      data: { sku: altegio.id, altegioGoodId: altegio.id, isActive: true },
    });
    product.altegioGoodId = altegio.id;
    console.log(`[warehouse/docs] Проведення ${doc.id}: картку «${product.title}» створено в Altegio id=${altegio.id}`);
  }
}

/**
 * Що ще не заповнено в прийомці: вага (для волосся), ціна закупки, ціна продажу, кількість, група нової картки.
 * Порожній список — можна проводити.
 */
export async function missingIntakeFields(documentId: string): Promise<string[]> {
  const doc = await prisma.warehouseDocument.findUnique({
    where: { id: documentId },
    include: { lines: { include: { product: true } } },
  });
  if (!doc) return ["документ не знайдено"];
  const missing: string[] = [];
  if (!(Number(doc.invoiceAmount) > 0)) missing.push("сума накладної");
  if (doc.kind === "hair" && !(Number(doc.invoiceWeightGrams) > 0)) missing.push("вага партії");
  if (doc.lines.length === 0) missing.push(doc.kind === "hair" ? "хвости" : "товари");
  doc.lines.forEach((line, idx) => {
    const name = doc.kind === "hair" ? `хвіст ${line.product.title || idx + 1}` : `«${line.product.title || `рядок ${idx + 1}`}»`;
    const gaps: string[] = [];
    if (doc.kind === "hair") {
      if (!(Number(line.weightGrams) > 0)) gaps.push("вага");
      if (!(Number(line.product.lengthCm) > 0)) gaps.push("довжина");
    } else if (!(Number(line.quantity) > 0)) gaps.push("кількість");
    if (!(Number(line.costPerUnit) > 0)) gaps.push("ціна закупки");
    if (!(Number(line.product.salePrice) > 0)) gaps.push("ціна продажу");
    if (!line.product.altegioGoodId && !line.product.groupId) gaps.push("група");
    if (gaps.length) missing.push(`${name}: ${gaps.join(", ")}`);
  });
  // Код хвоста — назва картки: не має збігатися з уже наявною карткою волосся
  if (doc.kind === "hair") {
    const codes = doc.lines.filter((line) => !line.product.altegioGoodId).map((line) => line.product.title);
    const dupes = codes.length
      ? await prisma.warehouseProduct.findMany({
          where: { isHair: true, title: { in: codes }, altegioGoodId: { not: null } },
          select: { title: true },
        })
      : [];
    if (dupes.length) missing.push(`коди вже зайняті: ${[...new Set(dupes.map((row) => row.title))].join(", ")}`);
  }
  return missing;
}

/**
 * Проведення документа: лише воно міняє залишки і пише прийомку/списання в Altegio.
 * Підходить і для повтору після помилки Altegio.
 */
export async function postWarehouseDocument(documentId: string, postedBy?: string) {
  const current = await prisma.warehouseDocument.findUnique({
    where: { id: documentId },
    select: { status: true, syncStatus: true, altegioTxId: true, source: true, type: true },
  });
  if (!current) throw new Error("Документ не знайдено");
  if (current.source !== "kresco") throw new Error("Імпортовані з Altegio документи повторно не відправляємо");
  if (current.status === "posted") throw new Error("Документ уже проведено");
  if (current.type === "inventory_count") {
    throw new Error("Інвентаризацію в Altegio не відправляємо — лише автоприйомку та автосписання");
  }

  // Прийомку проводимо лише повністю заповнену
  if (current.type === "intake" && !current.altegioTxId) {
    const missing = await missingIntakeFields(documentId);
    if (missing.length) throw new Error(`Не заповнено: ${missing.join("; ")}`);
  }

  // Altegio документ уже прийняв (впало застосування залишку) — лише доводимо до кінця в Kresco
  if (current.altegioTxId) {
    await prisma.warehouseDocument.update({
      where: { id: documentId },
      data: { status: "posted", syncStatus: "synced", syncError: null },
    });
    await applyPostedWarehouseDocument(documentId);
    console.log(`[warehouse/docs] Проведення ${documentId}: в Altegio вже є id=${current.altegioTxId}, застосовано залишок`);
    return getWarehouseDocument(documentId);
  }

  // Захоплюємо документ, щоб подвійний клік не провів його двічі
  const claimed = await prisma.warehouseDocument.updateMany({
    where: {
      id: documentId,
      OR: [
        { status: { in: ["draft", "sync_error"] } },
        { status: "pending", updatedAt: { lt: new Date(Date.now() - POSTING_STALE_MS) } },
      ],
    },
    data: { status: "pending", syncStatus: "pending" },
  });
  if (claimed.count === 0) throw new Error("Документ уже проводиться — оновіть сторінку за хвилину");
  console.log(`[warehouse/docs] Проведення ${documentId} (${current.type}) — ${postedBy || "?"}`);

  const doc = await prisma.warehouseDocument.findUnique({
    where: { id: documentId },
    include: { lines: { include: { product: true } }, toStorage: true, fromStorage: true },
  });
  if (!doc) throw new Error("Документ не знайдено");

  if (doc.type === "intake") {
    try {
      await prepareIntakeProductsForPosting(doc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.warehouseDocument.update({
        where: { id: doc.id },
        data: { status: "sync_error", syncStatus: "error", syncError: message },
      });
      console.error(`[warehouse/docs] Проведення ${doc.id}: картки не створились:`, message);
      throw new Error(message);
    }
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
    const fromAltegioId = doc.fromStorage ? altegioStorageIdForWrites(doc.fromStorage) : null;
    const toAltegioId = doc.toStorage ? altegioStorageIdForWrites(doc.toStorage) : null;
    if (!fromAltegioId || !toAltegioId) {
      throw new Error("Немає складів Altegio для переміщення");
    }
    try {
      const op = await createAltegioStorageTransfer({
        fromStorageId: fromAltegioId,
        toStorageId: toAltegioId,
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
  const storageAltegioId = storage ? altegioStorageIdForWrites(storage) : null;
  if (!storageAltegioId) throw new Error("Немає складу Altegio");
  const typeId = doc.type === "write_off" ? ALTEGIO_STORAGE_OP.writeOff : ALTEGIO_STORAGE_OP.receipt;

  await postOperationAndApply({
    documentId: doc.id,
    typeId,
    storageAltegioId,
    comment: doc.comment || doc.title || "Kresco",
    occurredAt: doc.occurredAt,
    lines,
  });
  return prisma.warehouseDocument.findUnique({
    where: { id: documentId },
    include: { lines: { include: { product: true } }, toStorage: true, fromStorage: true, children: true },
  });
}

/** Повтор запису в Altegio — те саме проведення. */
export const retryWarehouseDocumentSync = postWarehouseDocument;

/** Склад волосся: туди прив'язані групи волосся (Хвости, Треси…); запасний варіант — склад «Волосся». */
export async function resolveHairStorageId(): Promise<string> {
  const bound = await prisma.warehouseProductGroup.findFirst({
    where: { isHair: true, storageId: { not: null } },
    select: { storageId: true },
  });
  if (bound?.storageId) return bound.storageId;
  const byTitle = await prisma.warehouseStorage.findFirst({ where: { title: "Волосся" }, select: { id: true } });
  if (!byTitle) throw new Error("Не знайдено складу волосся");
  return byTitle.id;
}

/** Наступні вільні коди хвостів: найбільший числовий код волосся + 1 (з тими ж провідними нулями). */
async function nextHairCodes(count: number, taken: Set<string>): Promise<string[]> {
  if (count <= 0) return [];
  const rows = await prisma.warehouseProduct.findMany({ where: { isHair: true }, select: { title: true } });
  let max = 0;
  let width = 5;
  for (const row of rows) {
    const code = row.title.trim();
    if (!/^\d{1,9}$/.test(code)) continue;
    taken.add(code);
    const n = Number(code);
    if (n > max) {
      max = n;
      width = Math.max(width, code.length);
    }
  }
  const codes: string[] = [];
  let n = max;
  while (codes.length < count) {
    n += 1;
    const code = String(n).padStart(width, "0");
    if (taken.has(code)) continue;
    taken.add(code);
    codes.push(code);
  }
  return codes;
}

/**
 * Прийомка волосся завжди створюється чернеткою: можна зберегти неповною, проводить кнопка «Провести».
 * Склад — завжди склад волосся. Код хвоста = назва картки (як у наявних картках); порожній — генеруємо.
 * replaceDocumentId — редагування чернетки: нова версія займає її місце (номер і дата створення ті самі).
 */
export async function createHairIntake(input: {
  groupId?: string;
  title?: string;
  weightKg?: number;
  invoiceAmountUsd?: number;
  deliveryAmountUsd?: number;
  occurredAt?: string;
  createdBy?: string | null;
  replaceDocumentId?: string;
  lines: Array<{ code?: string; lengthCm?: number; weightGrams?: number; salePrice?: number }>;
}) {
  const replaced = input.replaceDocumentId ? await requireEditableDraft(input.replaceDocumentId, "intake") : null;
  const storageId = await resolveHairStorageId();
  const group =
    (input.groupId ? await prisma.warehouseProductGroup.findUnique({ where: { id: input.groupId } }) : null) ||
    (await prisma.warehouseProductGroup.findFirst({ where: { isHair: true, storageId }, orderBy: { sortOrder: "asc" } }));
  if (!group) throw new Error("Немає групи волосся");

  const title = twoWordTitle(input.title || "") || "Прийомка волосся";
  const kg = Number(input.weightKg) || 0;
  const invoiceUsd = Number(input.invoiceAmountUsd) || 0;
  const deliveryUsd = Number(input.deliveryAmountUsd) || 0;
  const fx = await requireUsdUahRate();
  const invoiceGrams = round2(kg * 1000);
  const costPerGramUsd = invoiceGrams > 0 && invoiceUsd > 0 ? (invoiceUsd + deliveryUsd) / invoiceGrams : 0;

  const rawLines = (input.lines || [])
    .map((line) => ({
      code: String(line.code || "").trim(),
      lengthCm: Math.round(Number(line.lengthCm) || 0),
      weightGrams: Number(line.weightGrams) || 0,
      salePrice: Number(line.salePrice) || 0,
    }))
    .filter((line) => line.code || line.lengthCm > 0 || line.weightGrams > 0 || line.salePrice > 0);

  const taken = new Set(rawLines.map((line) => line.code).filter(Boolean));
  const autoCodes = await nextHairCodes(rawLines.filter((line) => !line.code).length, taken);
  for (const line of rawLines) if (!line.code) line.code = autoCodes.shift() as string;

  const sumGrams = round2(rawLines.reduce((acc, line) => acc + line.weightGrams, 0));
  const delta = round2(sumGrams - invoiceGrams);
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : replaced?.occurredAt || new Date();
  const kyivDay = kyivYmdFromDateTimeInput(occurredAt) || kyivCalendarTodayYmd();

  const created: Array<{ productId: string; weightGrams: number | null; costUsd: number; costUah: number }> = [];
  for (const line of rawLines) {
    const costUsd = round2(costPerGramUsd * line.weightGrams);
    const costUah = round2(costUsd * fx.rate);
    // Картка лише в Kresco і неактивна — в Altegio її створить проведення
    const product = await prisma.warehouseProduct.create({
      data: {
        title: line.code,
        category: group.title,
        groupId: group.id,
        unit: "шт",
        costPerUnit: costUah,
        costUsd,
        salePrice: line.salePrice,
        isHair: true,
        lengthCm: line.lengthCm || null,
        weightGrams: line.weightGrams || null,
        isActive: false,
      },
    });
    created.push({ productId: product.id, weightGrams: line.weightGrams || null, costUsd, costUah });
  }

  const document = await prisma.warehouseDocument.create({
    data: {
      type: "intake",
      status: "draft",
      kind: "hair",
      title,
      currencyCode: "USD",
      invoiceAmount: invoiceUsd,
      deliveryAmount: deliveryUsd,
      invoiceWeightGrams: invoiceGrams,
      weightDeltaGrams: delta,
      fxRateUsdUah: fx.rate,
      weightMismatch: invoiceGrams > 0 && Math.abs(delta) > HAIR_WEIGHT_TOLERANCE_G,
      syncStatus: "draft",
      occurredAt,
      kyivDay,
      toStorageId: storageId,
      comment: `Прийомка волосся ${kg} кг / ${invoiceUsd}$${deliveryUsd ? ` + доставка ${deliveryUsd}$` : ""}`,
      source: "kresco",
      createdBy: replaced?.createdBy ?? (input.createdBy || null),
      ...(replaced ? { createdAt: replaced.createdAt } : {}),
      lines: {
        create: created.map((line) => ({
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
  if (replaced) await deleteWarehouseDocument(replaced.id, `${input.createdBy || "?"} (редагування)`);
  console.log(
    `[warehouse/docs] ${replaced ? `Чернетку ${replaced.id} оновлено →` : "Чернетка прийомки волосся"} ${document.id}: хвостів=${created.length}`,
  );

  return prisma.warehouseDocument.findUniqueOrThrow({
    where: { id: document.id },
    include: { lines: { include: { product: { include: { group: true } } } }, toStorage: true },
  });
}

/** Чернетка, яку можна редагувати: документ Kresco потрібного типу, ще не проведений. */
async function requireEditableDraft(id: string, type: string) {
  const doc = await prisma.warehouseDocument.findUnique({ where: { id } });
  if (!doc || doc.source !== "kresco" || doc.type !== type) throw new Error("Чернетку не знайдено");
  if (doc.status !== "draft") throw new Error("Редагувати можна лише непроведений документ");
  return doc;
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
    /** Ціна продажу, грн — у чернетці пишемо в картку Kresco, в Altegio — при проведенні */
    salePrice?: number;
  }>;
  /**
   * Чернетка: можна зберегти неповною; нові картки лише в Kresco, собівартість товарів не міняємо,
   * в Altegio не пишемо — усе це робить проведення.
   */
  draft?: boolean;
  /** Редагування чернетки: нова версія займає її місце (номер і дата створення ті самі). */
  replaceDocumentId?: string;
}) {
  const storage = await requireStorage(input.storageId);
  const draft = input.draft === true || Boolean(input.replaceDocumentId);
  const replaced = input.replaceDocumentId ? await requireEditableDraft(input.replaceDocumentId, "intake") : null;
  const title = twoWordTitle(input.title) || (draft ? "Прийомка товару" : "");
  if (!title) throw new Error("Назва прийомки — два слова");

  const enabled = await getEnabledCurrencyCodes();
  const docCurrencyFallback = String(input.currencyCode || "UAH").toUpperCase();

  const invoiceAmount = Number(input.invoiceAmount) || 0;
  const deliveryAmount = Number(input.deliveryAmount) || 0;
  if (!draft && !(invoiceAmount > 0)) throw new Error("Вкажіть суму накладної (без доставки)");

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
        salePrice: Number(line.salePrice) || 0,
      };
    })
    // Чернетка тримає й неповні рядки — аби був товар
    .filter((line) => (line.productId || line.title) && (draft || (line.quantity > 0 && line.price > 0)));
  if (!draft && rawLines.length === 0) throw new Error("Додайте рядки: кількість і ціна закупки");

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

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : replaced?.occurredAt || new Date();
  const kyivDay = kyivYmdFromDateTimeInput(occurredAt) || kyivCalendarTodayYmd();

  const prepared: Array<{
    productId: string;
    altegioGoodId: number | null;
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
    if (!product && draft) {
      // Групу можна обрати пізніше — без неї документ не проведеться
      const group = line.groupId ? await prisma.warehouseProductGroup.findUnique({ where: { id: line.groupId } }) : null;
      product = await prisma.warehouseProduct.create({
        data: {
          title: line.title,
          category: group?.title ?? null,
          groupId: group?.id ?? null,
          unit: "шт",
          costPerUnit: converted.amountUah,
          costUsd: currency === "USD" ? unitDoc : 0,
          salePrice: line.salePrice,
          isHair: group?.isHair ?? false,
          isActive: false,
        },
        include: { group: true },
      });
    } else if (!product) {
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
    } else if (!product.altegioGoodId && (product.isActive || !draft)) {
      throw new Error(`Товар «${product.title}» без id Altegio. Оновіть дзеркало складу.`);
    } else if (draft) {
      // Ціна продажу — властивість картки, не залишку: пишемо в Kresco одразу, в Altegio — при проведенні
      if (line.salePrice > 0 && line.salePrice !== product.salePrice) {
        await prisma.warehouseProduct.update({ where: { id: product.id }, data: { salePrice: line.salePrice } });
      }
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
      altegioGoodId: product.altegioGoodId,
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
      status: draft ? "draft" : "pending",
      kind: "goods",
      title,
      currencyCode: currency,
      invoiceAmount,
      deliveryAmount,
      fxRateUsdUah: sharedFx,
      syncStatus: draft ? "draft" : "pending",
      occurredAt,
      kyivDay,
      toStorageId: storage.id,
      comment: `Прийомка товару ${invoiceAmount} ${currency}${deliveryAmount ? ` + доставка ${deliveryAmount}` : ""}`,
      source: "kresco",
      createdBy: replaced?.createdBy ?? (input.createdBy || null),
      ...(replaced ? { createdAt: replaced.createdAt } : {}),
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

  if (draft) {
    if (replaced) await deleteWarehouseDocument(replaced.id, `${input.createdBy || "?"} (редагування)`);
    console.log(
      `[warehouse/docs] ${replaced ? `Чернетку ${replaced.id} оновлено →` : "Чернетка прийомки товару"} ${document.id}: рядків=${prepared.length}`,
    );
  } else await postOperationAndApply({
    documentId: document.id,
    typeId: ALTEGIO_STORAGE_OP.receipt,
    storageAltegioId: storage.altegioStorageId as number,
    comment: document.comment || title,
    occurredAt,
    lines: prepared.map((line) => ({
      altegioGoodId: line.altegioGoodId as number,
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
  /** Списання з каси запису Kresco: зменшити залишок тут, в Altegio не відправляти. */
  localOnly?: boolean;
  /** Чернетка: залишок не міняємо і в Altegio не пишемо — це робить проведення. */
  draft?: boolean;
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
      status: input.draft ? "draft" : "pending",
      kind: "goods",
      title,
      currencyCode: "UAH",
      syncStatus: input.draft ? "draft" : "pending",
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

  if (input.draft) {
    console.log(`[warehouse/docs] Чернетка списання ${document.id}: рядків=${rawLines.length}`);
  } else if (input.localOnly) {
    await prisma.warehouseDocument.update({
      where: { id: document.id },
      data: { status: "posted", syncStatus: "local", syncError: null },
    });
    await applyPostedWarehouseDocument(document.id);
    console.log(`[warehouse/docs] Списання ${document.id} лише в Kresco (каса запису)`);
  } else {
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
  }

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
  // Склад лише в Kresco наповнюється за групами товарів (див. WarehouseProductGroup.storageId):
  // ручне переміщення з / на нього в Altegio означало б реальний рух між складами Altegio.
  if (from.krescoOnly || to.krescoOnly) {
    throw new Error(
      `Склад «${from.krescoOnly ? from.title : to.title}» є лише в Kresco: товари на ньому визначаються групою, переміщення не потрібне`,
    );
  }

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
      salonCheckout: { select: { id: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 300,
  });
}

/**
 * Наскрізні номери документів Kresco за порядком створення: 1, 2, 3…
 * Продажі (списання з оплати запису) нумеруються окремо від прийомок, списань і переміщень.
 */
export async function warehouseDocumentNumbers(): Promise<Map<string, number>> {
  const rows = await prisma.warehouseDocument.findMany({
    where: { source: "kresco" },
    select: { id: true, salonCheckout: { select: { id: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const numbers = new Map<string, number>();
  let docNo = 0;
  let saleNo = 0;
  for (const row of rows) numbers.set(row.id, row.salonCheckout ? ++saleNo : ++docNo);
  return numbers;
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
      salonCheckout: { select: { id: true } },
    },
  });
}

/**
 * Видалення документа: спершу в Altegio (якщо він туди записаний), потім у Kresco.
 * Altegio відмовив — нічого не видаляємо. Залишки Kresco підтягнуться з Altegio при синхронізації дзеркала.
 * Рядки видаляються каскадом, дочірні документи й чек журналу лише втрачають посилання.
 */
export async function deleteWarehouseDocument(id: string, deletedBy: string) {
  const doc = await prisma.warehouseDocument.findUnique({
    where: { id },
    select: {
      id: true,
      source: true,
      type: true,
      status: true,
      title: true,
      kyivDay: true,
      altegioTxId: true,
      lines: { select: { productId: true } },
    },
  });
  if (!doc) throw new Error("Документ не знайдено");
  if (doc.source !== "kresco") throw new Error("Видаляти можна лише документи Kresco");

  let altegio: "deleted" | "already_gone" | "none" = "none";
  if (doc.altegioTxId) {
    const result = await deleteAltegioStorageDocument(doc.altegioTxId);
    altegio = result.alreadyGone ? "already_gone" : "deleted";
  }

  await prisma.warehouseDocument.delete({ where: { id } });

  // Картки, створені чернеткою лише в Kresco і більше ніде не вжиті, теж прибираємо
  if (doc.type === "intake" && doc.status !== "posted") {
    const orphans = await prisma.warehouseProduct.deleteMany({
      where: {
        id: { in: doc.lines.map((line) => line.productId) },
        altegioGoodId: null,
        isActive: false,
        lines: { none: {} },
        checkoutGoods: { none: {} },
        appointmentGoods: { none: {} },
      },
    });
    if (orphans.count) console.log(`[warehouse/documents] Видалено карток чернетки: ${orphans.count}`);
  }
  console.log(
    `[warehouse/documents] Видалено документ ${doc.type} «${doc.title || ""}» ${doc.kyivDay} id=${id} altegioTxId=${doc.altegioTxId ?? "—"} altegio=${altegio} (видалив ${deletedBy})`,
  );
  const { lines: _lines, ...rest } = doc;
  return { ...rest, altegio };
}
