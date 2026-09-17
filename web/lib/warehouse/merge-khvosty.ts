// Перенесення хвостів у групу «Хвости». Порожню групу в Kresco видаляємо лише коли в ній уже 0 товарів.

import { prisma } from "@/lib/prisma";
import {
  createAltegioGoodsCategory,
  listAltegioGoodsCategories,
  updateAltegioGoodCategory,
} from "@/lib/altegio/warehouse-write";
import { ensureGroupFromCategory } from "./catalog";

export const KHVOSTY_GROUP_TITLE = "Хвости";

export type KhvostyPair = {
  targetAltegioCategoryId: number;
  targetGroupId: string;
};

export type MergeKhvostyResult = KhvostyPair & {
  movedAltegio: number;
  movedKresco: number;
  altegioErrors: number;
  errors: string[];
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

/** Старі категорії Altegio в Kresco завжди кладемо в «Хвости», щоб імпорт не повертав товар назад. */
export function resolveKrescoGroupTitle(title: string): string {
  return isSourceHairTailsGroup(title) ? KHVOSTY_GROUP_TITLE : String(title || "").trim();
}

async function ensureKhvostyAltegioCategory(): Promise<{ id: number; title: string }> {
  const categories = await listAltegioGoodsCategories();
  const existing = categories.find(
    (row) => normalizeGroupTitle(row.title) === normalizeGroupTitle(KHVOSTY_GROUP_TITLE),
  );
  if (existing) {
    console.log(`[warehouse/khvosty] Категорія Altegio «${existing.title}» id=${existing.id} вже є`);
    return existing;
  }
  const created = await createAltegioGoodsCategory(KHVOSTY_GROUP_TITLE);
  console.log(`[warehouse/khvosty] Створено категорію Altegio «${KHVOSTY_GROUP_TITLE}» id=${created.id}`);
  return created;
}

export async function ensureKhvostyPair(): Promise<KhvostyPair> {
  const targetAltegio = await ensureKhvostyAltegioCategory();
  const targetGroup = await ensureGroupFromCategory({
    title: KHVOSTY_GROUP_TITLE,
    altegioCategoryId: targetAltegio.id,
    isHair: true,
  });
  if (!targetGroup) {
    throw new Error("Не вдалося створити групу «Хвости» у Kresco");
  }
  return { targetAltegioCategoryId: targetAltegio.id, targetGroupId: targetGroup.id };
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

export async function syncKhvostyGoodsToAltegio(
  targetAltegioCategoryId: number,
  targetGroupId: string,
): Promise<{
  movedAltegio: number;
  altegioErrors: number;
  errors: string[];
}> {
  const products = await prisma.warehouseProduct.findMany({
    where: { groupId: targetGroupId, altegioGoodId: { not: null } },
  });
  let movedAltegio = 0;
  let altegioErrors = 0;
  const errors: string[] = [];
  for (const product of products) {
    const altegioGoodId = Number(product.altegioGoodId || 0);
    if (!(altegioGoodId > 0)) continue;
    try {
      await updateAltegioGoodCategory(altegioGoodId, targetAltegioCategoryId);
      movedAltegio += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      altegioErrors += 1;
      errors.push(`${product.title} (${altegioGoodId}): ${message}`);
      console.warn(`[warehouse/khvosty] Altegio не оновив «${product.title}» id=${altegioGoodId}:`, message);
    }
  }
  return { movedAltegio, altegioErrors, errors: errors.slice(0, 30) };
}

/** Видаляємо групу в Kresco лише якщо в ній зараз 0 товарів. Altegio не чіпаємо. */
export async function deleteEmptySourceKrescoGroups(keepGroupId?: string | null): Promise<string[]> {
  const leftoverGroups = await prisma.warehouseProductGroup.findMany();
  const deleted: string[] = [];
  for (const group of leftoverGroups) {
    if (keepGroupId && group.id === keepGroupId) continue;
    if (!isSourceHairTailsGroup(group.title)) continue;
    const liveCount = await prisma.warehouseProduct.count({ where: { groupId: group.id } });
    if (liveCount > 0) {
      console.log(`[warehouse/khvosty] Групу «${group.title}» не видаляємо: ще ${liveCount} товарів`);
      continue;
    }
    await prisma.warehouseProductGroup.delete({ where: { id: group.id } });
    deleted.push(group.title);
    console.log(
      `[warehouse/khvosty] Видалено порожню групу Kresco «${group.title}» (Altegio не чіпаємо)`,
    );
  }
  return deleted;
}

export async function mergeHairTailsIntoKhvosty(): Promise<MergeKhvostyResult> {
  const pair = await ensureKhvostyPair();
  const movedKresco = await moveKrescoProductsToKhvosty(pair.targetGroupId);
  const altegio = await syncKhvostyGoodsToAltegio(pair.targetAltegioCategoryId, pair.targetGroupId);
  const deletedKrescoGroups = await deleteEmptySourceKrescoGroups(pair.targetGroupId);
  const result: MergeKhvostyResult = {
    ...pair,
    movedKresco,
    deletedKrescoGroups,
    ...altegio,
  };
  console.log("[warehouse/khvosty] Готово:", result);
  return result;
}
