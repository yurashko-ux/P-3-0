// Перенесення хвостів у групу «Хвости» (Altegio + Kresco). Порожні групи прибираємо лише в Kresco.

import { prisma } from "@/lib/prisma";
import {
  createAltegioGoodsCategory,
  listAltegioGoodsCategories,
  updateAltegioGoodCategory,
} from "@/lib/altegio/warehouse-write";
import { ensureGroupFromCategory } from "./catalog";

export const KHVOSY_GROUP_TITLE = "Хвости";

export type MergeKhvostyResult = {
  targetAltegioCategoryId: number;
  movedAltegio: number;
  movedKresco: number;
  skipped: number;
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
  if (n === normalizeGroupTitle(KHVOSY_GROUP_TITLE)) return false;
  if (n === "преміум хвости" || n === "шаньйони" || n === "шанйони") return true;
  return /^волосся(\s+до)?\s+(40|45|50|60|70|80)\s*см$/.test(n);
}

async function ensureKhvostyAltegioCategory(): Promise<{ id: number; title: string }> {
  const categories = await listAltegioGoodsCategories();
  const existing = categories.find((row) => normalizeGroupTitle(row.title) === normalizeGroupTitle(KHVOSY_GROUP_TITLE));
  if (existing) {
    console.log(`[warehouse/khvosty] Категорія Altegio «${existing.title}» id=${existing.id} вже є`);
    return existing;
  }
  const created = await createAltegioGoodsCategory(KHVOSY_GROUP_TITLE);
  console.log(`[warehouse/khvosty] Створено категорію Altegio «${KHVOSY_GROUP_TITLE}» id=${created.id}`);
  return created;
}

export async function mergeHairTailsIntoKhvosty(): Promise<MergeKhvostyResult> {
  const errors: string[] = [];
  const targetAltegio = await ensureKhvostyAltegioCategory();
  const targetGroup = await ensureGroupFromCategory({
    title: KHVOSY_GROUP_TITLE,
    altegioCategoryId: targetAltegio.id,
    isHair: true,
  });
  if (!targetGroup) {
    throw new Error("Не вдалося створити групу «Хвости» у Kresco");
  }

  const products = await prisma.warehouseProduct.findMany({
    where: { isActive: true },
    include: { group: true },
  });
  const toMove = products.filter((product) => {
    const groupTitle = product.group?.title || product.category || "";
    return isSourceHairTailsGroup(groupTitle);
  });

  console.log(`[warehouse/khvosty] До перенесення в «Хвости»: ${toMove.length} карток`);

  let movedAltegio = 0;
  let movedKresco = 0;
  let skipped = 0;

  for (const product of toMove) {
    const altegioGoodId = Number(product.altegioGoodId || 0);
    if (altegioGoodId > 0) {
      try {
        await updateAltegioGoodCategory(altegioGoodId, targetAltegio.id);
        movedAltegio += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${product.title} (${altegioGoodId}): ${message}`);
        console.warn(`[warehouse/khvosty] Не перенесено в Altegio «${product.title}» id=${altegioGoodId}:`, message);
        skipped += 1;
        continue;
      }
    } else {
      console.log(`[warehouse/khvosty] «${product.title}» без id Altegio — лише Kresco`);
    }

    await prisma.warehouseProduct.update({
      where: { id: product.id },
      data: {
        groupId: targetGroup.id,
        category: KHVOSY_GROUP_TITLE,
        isHair: true,
      },
    });
    movedKresco += 1;
  }

  const leftoverGroups = await prisma.warehouseProductGroup.findMany({
    include: { _count: { select: { products: true } } },
  });
  const deletedKrescoGroups: string[] = [];
  for (const group of leftoverGroups) {
    if (group.id === targetGroup.id) continue;
    if (!isSourceHairTailsGroup(group.title)) continue;
    if (group._count.products > 0) continue;
    await prisma.warehouseProductGroup.delete({ where: { id: group.id } });
    deletedKrescoGroups.push(group.title);
    console.log(
      `[warehouse/khvosty] Видалено порожню групу Kresco «${group.title}» (Altegio категорію не чіпаємо)`,
    );
  }

  const result: MergeKhvostyResult = {
    targetAltegioCategoryId: targetAltegio.id,
    movedAltegio,
    movedKresco,
    skipped,
    errors: errors.slice(0, 30),
    deletedKrescoGroups,
  };
  console.log("[warehouse/khvosty] Готово:", result);
  return result;
}
