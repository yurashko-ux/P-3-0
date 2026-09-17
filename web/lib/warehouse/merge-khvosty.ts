// Група «Хвости» лише в Kresco. Altegio не створюємо, не переносимо і не видаляємо.

import { prisma } from "@/lib/prisma";
import { listAltegioGoodsCategories } from "@/lib/altegio/warehouse-write";

export const KHVOSTY_GROUP_TITLE = "Хвости";

export type MergeKhvostyResult = {
  targetGroupId: string;
  movedKresco: number;
  deletedKrescoGroups: string[];
};

function normalizeGroupTitle(title: string): string {
  return String(title || "")
    .toLocaleLowerCase("uk-UA")
    .replace(/ё/g, "е")
    .replace(/[.’'`]/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSourceHairTailsGroup(title: string): boolean {
  const n = normalizeGroupTitle(title);
  if (!n) return false;
  if (n === normalizeGroupTitle(KHVOSTY_GROUP_TITLE)) return false;
  if (n === "преміум хвости" || n === "преміум хвіст") return true;
  if (n === "шаньйони" || n === "шанйони") return true;
  return /^волосся(\s+до)?\s+(40|45|50|60|70|80)\s*см$/.test(n);
}

export function isKhvostyKrescoGroup(title: string): boolean {
  return normalizeGroupTitle(title) === normalizeGroupTitle(KHVOSTY_GROUP_TITLE);
}

/** Стара категорія Altegio → група Kresco «Хвости». */
export function resolveKrescoGroupTitle(title: string): string {
  return isSourceHairTailsGroup(title) ? KHVOSTY_GROUP_TITLE : String(title || "").trim();
}

export async function ensureKhvostyGroup(): Promise<{ id: string; title: string }> {
  const existing = await prisma.warehouseProductGroup.findFirst({
    where: { title: { equals: KHVOSTY_GROUP_TITLE, mode: "insensitive" } },
  });
  if (existing) {
    return prisma.warehouseProductGroup.update({
      where: { id: existing.id },
      data: { title: KHVOSTY_GROUP_TITLE, isHair: true, isActive: true, altegioCategoryId: null },
    });
  }
  const created = await prisma.warehouseProductGroup.create({
    data: {
      title: KHVOSTY_GROUP_TITLE,
      isHair: true,
      altegioCategoryId: null,
      isActive: true,
    },
  });
  console.log(`[warehouse/khvosty] Створено групу Kresco «${KHVOSTY_GROUP_TITLE}» id=${created.id}`);
  return created;
}

export async function moveKrescoProductsToKhvosty(targetGroupId: string): Promise<number> {
  const products = await prisma.warehouseProduct.findMany({
    include: { group: true },
  });
  let moved = 0;
  for (const product of products) {
    if (product.groupId === targetGroupId) continue;
    const groupTitle = product.group?.title || product.category || "";
    if (!isSourceHairTailsGroup(groupTitle)) continue;
    await prisma.warehouseProduct.update({
      where: { id: product.id },
      data: {
        groupId: targetGroupId,
        category: KHVOSTY_GROUP_TITLE,
        isHair: true,
      },
    });
    moved += 1;
  }
  console.log(`[warehouse/khvosty] У Kresco перенесено ${moved} карток у «Хвости»`);
  return moved;
}

/** Dual-write нової картки: у Altegio пишемо в стару категорію, групу Altegio не створюємо. */
export async function altegioCategoryIdForKrescoWrite(group: {
  title: string;
  altegioCategoryId: number | null;
}): Promise<number> {
  if (isKhvostyKrescoGroup(group.title) || isSourceHairTailsGroup(group.title)) {
    const existing = await pickExistingAltegioSourceCategoryId();
    if (!existing) {
      throw new Error(
        `Для групи «${KHVOSTY_GROUP_TITLE}» у Altegio лишаються старі категорії. Немає жодної з них, щоб записати нову картку.`,
      );
    }
    return existing;
  }
  if (group.altegioCategoryId && group.altegioCategoryId > 0) return group.altegioCategoryId;
  throw new Error("Немає категорії Altegio для групи");
}

export async function pickExistingAltegioSourceCategoryId(): Promise<number | null> {
  const categories = await listAltegioGoodsCategories();
  const preferred = categories.find((row) => normalizeGroupTitle(row.title) === "преміум хвости");
  if (preferred) return preferred.id;
  const any = categories.find((row) => isSourceHairTailsGroup(row.title));
  return any?.id ?? null;
}

/** Видаляємо групу в Kresco лише якщо в ній зараз 0 товарів. Altegio не чіпаємо. */
export async function deleteEmptySourceKrescoGroups(keepGroupId?: string | null): Promise<string[]> {
  const leftoverGroups = await prisma.warehouseProductGroup.findMany();
  const deleted: string[] = [];
  for (const group of leftoverGroups) {
    if (keepGroupId && group.id === keepGroupId) continue;
    const extraKhvosty = isKhvostyKrescoGroup(group.title);
    if (!isSourceHairTailsGroup(group.title) && !extraKhvosty) continue;
    const liveCount = await prisma.warehouseProduct.count({ where: { groupId: group.id } });
    if (liveCount > 0) {
      console.log(`[warehouse/khvosty] Групу «${group.title}» не видаляємо: ще ${liveCount} товарів`);
      continue;
    }
    await prisma.warehouseProductGroup.delete({ where: { id: group.id } });
    deleted.push(group.title);
    console.log(`[warehouse/khvosty] Видалено порожню групу Kresco «${group.title}» (Altegio не чіпаємо)`);
  }
  return deleted;
}

export async function mergeHairTailsIntoKhvosty(): Promise<MergeKhvostyResult> {
  const target = await ensureKhvostyGroup();
  const movedKresco = await moveKrescoProductsToKhvosty(target.id);
  const deletedKrescoGroups = await deleteEmptySourceKrescoGroups(target.id);
  const result: MergeKhvostyResult = {
    targetGroupId: target.id,
    movedKresco,
    deletedKrescoGroups,
  };
  console.log("[warehouse/khvosty] Готово (лише Kresco):", result);
  return result;
}
